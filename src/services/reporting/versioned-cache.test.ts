// PBI 93610 — acceptance, end to end through the real dataset layer: a wall screen rotating its pages
// every 20 s costs Fabric nothing while the Gold data version is unchanged, picks up a new load within
// one probe interval, and keeps working (on the old wall-clock TTLs) when the version cannot be read.
//
// `run` is the only seam mocked: it is the single place a statement leaves the process, so counting its
// calls counts what Fabric sees.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";

const lake = vi.hoisted(() => ({
  statements: [] as string[],
  versionProbes: 0,
  failProbe: false,
  loadStamp: "2026-10-23T05:44:00.000Z",
  rowCount: 1000,
}));

vi.mock("./query.js", () => ({
  run: vi.fn(async (_pool: unknown, q: { text: string }) => {
    if (q.text.includes("COUNT_BIG")) {
      lake.versionProbes++;
      if (lake.failProbe) throw new Error("ECONNRESET simulated");
      const tables = [...q.text.matchAll(/FROM dbo\.([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
      return tables.map((tbl) => ({ tbl, mx: new Date(lake.loadStamp), n: lake.rowCount }));
    }
    lake.statements.push(q.text);
    if (q.text.includes("MAX(LeadDate)")) return [{ maxDay: new Date("2026-10-22T00:00:00Z") }];
    if (q.text.includes("MAX(_etl_modified)")) return [{ at: new Date(lake.loadStamp) }];
    return [];
  }),
}));

import { clearCache, setCacheScope } from "./cache.js";
import { getDataset, type DatasetName } from "./datasets.js";
import { EMPTY_FILTERS } from "./filters.js";
import { startShareVersionWatcher, type ShareVersionWatcher } from "./share-version.js";

const config = {
  port: 0,
  nodeEnv: "test",
  logLevel: "silent",
  fabric: { endpoint: "x.datawarehouse.fabric.microsoft.com", database: "GAGold_Capricorn" },
  devUserEmail: null,
  reporting: {
    kioskToken: "",
    refreshSeconds: 60,
    cycleSeconds: 20,
    timeZone: "Europe/London",
    pacingMode: "mtd",
    cacheTtlSeconds: 45,
    versionedCacheMaxSeconds: 21_600,
  },
  targets: { adminEmails: [], storageAccount: "" },
  snapshots: { storageAccount: "", intervalMinutes: 30 },
} as unknown as Config;

// What a kiosk mounts, in order, every 20 s: the page's own dataset plus the live feed ticker, with
// `meta` polled alongside (Kiosk.tsx). Four wall pages.
const WALL: DatasetName[] = ["daily-run-chase", "office-run-chase", "adviser-league", "market-momentum"];

async function rotate(pages: number): Promise<void> {
  for (let i = 0; i < pages; i++) {
    const page = WALL[i % WALL.length];
    await getDataset(page, config, EMPTY_FILTERS);
    await getDataset("live-feed", config, EMPTY_FILTERS);
    await getDataset("meta", config, EMPTY_FILTERS);
    await vi.advanceTimersByTimeAsync(20_000);
  }
}

describe("a wall screen rotating pages", () => {
  let watcher: ShareVersionWatcher | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z")); // a Friday
    lake.statements = [];
    lake.versionProbes = 0;
    lake.failProbe = false;
    lake.loadStamp = "2026-10-23T05:44:00.000Z";
    lake.rowCount = 1000;
    clearCache();
    setCacheScope(null);
  });

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
    setCacheScope(null);
    clearCache();
    vi.useRealTimers();
  });

  it("CONTROL — with no data version it queries Fabric on nearly every page change (the problem)", async () => {
    await rotate(4); // fill
    const afterFirstCycle = lake.statements.length;
    await rotate(12); // 4 more minutes of rotation: every page is older than the 45 s TTL when it returns
    expect(lake.statements.length - afterFirstCycle).toBeGreaterThan(100);
  });

  it("queries Fabric zero times while the version is unchanged, however long it rotates", async () => {
    watcher = startShareVersionWatcher(config);
    setCacheScope(() => watcher!.cacheScope());
    await vi.advanceTimersByTimeAsync(0); // the first probe lands

    await rotate(4); // the one fill
    expect(lake.statements.length).toBeGreaterThan(0);
    const afterFill = lake.statements.length;

    await rotate(60); // 20 more minutes of rotation, two probe intervals
    expect(lake.versionProbes).toBeGreaterThanOrEqual(3);
    expect(lake.statements.length).toBe(afterFill);
  });

  it("shows a new load within one probe interval plus its confirmation, then goes quiet again", async () => {
    watcher = startShareVersionWatcher(config);
    setCacheScope(() => watcher!.cacheScope());
    await vi.advanceTimersByTimeAsync(0);
    await rotate(4);
    const afterFill = lake.statements.length;

    // Gold loads: stamps move and rows are added.
    lake.loadStamp = "2026-10-23T09:07:00.000Z";
    lake.rowCount = 1012;

    // Up to one probe interval to see it, plus the 5 minutes it must hold still before it is believed.
    await rotate(Math.ceil((10 * 60_000 + 7 * 60_000) / 20_000));
    const afterLoad = lake.statements.length;
    expect(afterLoad).toBeGreaterThan(afterFill); // the new version reached the data

    await rotate(30);
    expect(lake.statements.length).toBe(afterLoad); // and it is steady on the new version
  });

  it("rolls over at London midnight even though no load happened", async () => {
    vi.setSystemTime(new Date("2026-10-23T22:40:00Z")); // 23:40 in London (BST)
    watcher = startShareVersionWatcher(config);
    setCacheScope(() => watcher!.cacheScope());
    await vi.advanceTimersByTimeAsync(0);
    await rotate(4);
    const afterFill = lake.statements.length;
    await rotate(6); // still the 23rd in London
    expect(lake.statements.length).toBe(afterFill);

    vi.setSystemTime(new Date("2026-10-23T23:05:00Z")); // 00:05 on the 24th in London
    await rotate(4);
    expect(lake.statements.length).toBeGreaterThan(afterFill); // 'today' moved, so the payloads were rebuilt
  });

  it("keeps serving, on wall-clock TTLs, when the version can never be read", async () => {
    lake.failProbe = true;
    watcher = startShareVersionWatcher(config);
    setCacheScope(() => watcher!.cacheScope());
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.cacheScope()).toBeNull();

    await expect(getDataset("daily-run-chase", config, EMPTY_FILTERS)).resolves.toBeDefined();
    await expect(getDataset("meta", config, EMPTY_FILTERS)).resolves.toBeDefined();
    const afterFirst = lake.statements.length;
    await rotate(8);
    expect(lake.statements.length).toBeGreaterThan(afterFirst); // time-based refresh, as before this change
  });
});
