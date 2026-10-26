// PBI 93610 — a degraded answer must not be cached for hours.
//
// With the cache keyed on the Gold data version, an entry lives until the version or date moves (or the
// 6 h cap). Two readers swallow a storage failure and return an empty answer so the board never goes
// down: revisedWeekCount (0) and the reconciliation screen's history (weeks dropped). Cached by version,
// one blob hiccup would pin "0 revised weeks" or a history-less screen for hours. They must not be cached.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";

const rec = vi.hoisted(() => ({
  loadRevisionsChecked: vi.fn(),
}));

vi.mock("./query.js", () => ({
  run: vi.fn(async (_pool: unknown, q: { text: string }) => {
    if (q.text.includes("MAX(LeadDate)")) return [{ maxDay: new Date("2026-10-22T00:00:00Z") }];
    if (q.text.includes("MAX(_etl_modified)")) return [{ at: new Date("2026-10-23T05:44:00Z") }];
    return [];
  }),
}));

vi.mock("../snapshots/recorder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../snapshots/recorder.js")>()),
  loadRevisionsChecked: rec.loadRevisionsChecked,
  observeWeeks: vi.fn(async () => new Map()),
}));

vi.mock("../snapshots/history.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../snapshots/history.js")>()),
  needsExplaining: () => true,
}));

import { clearCache, setCacheScope } from "./cache.js";
import { getDataset } from "./datasets.js";
import { EMPTY_FILTERS } from "./filters.js";

const config = {
  fabric: { endpoint: "x", database: "y" },
  reporting: { timeZone: "Europe/London", cacheTtlSeconds: 45, refreshSeconds: 60, cycleSeconds: 20, pacingMode: "mtd" },
  targets: { adminEmails: [], storageAccount: "" },
  snapshots: { storageAccount: "acct", intervalMinutes: 30 },
} as unknown as Config;

const revision = { weekStart: "2026-09-12" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));
  clearCache();
  setCacheScope(() => "v1|2026-10-23"); // a known version: entries would otherwise live for hours
    rec.loadRevisionsChecked.mockReset();
});

afterEach(() => {
  setCacheScope(null);
  clearCache();
  vi.useRealTimers();
});

describe("revised-week count", () => {
  it("is not cached when a week of history could not be read: the header recovers on the next poll", async () => {
    rec.loadRevisionsChecked.mockResolvedValueOnce({ revisions: [revision], failed: 1 });
    const first = (await getDataset("meta", config, EMPTY_FILTERS)) as { revisedWeeks: number };
    expect(first.revisedWeeks).toBe(1); // degraded but served, never an error

    rec.loadRevisionsChecked.mockResolvedValue({ revisions: [revision, revision], failed: 0 });
    vi.advanceTimersByTime(60_000);
    const second = (await getDataset("meta", config, EMPTY_FILTERS)) as { revisedWeeks: number };
    expect(second.revisedWeeks).toBe(2);
  });

  it("is not cached when the read throws either (0 for that call only)", async () => {
    rec.loadRevisionsChecked.mockRejectedValueOnce(new Error("blob unreachable"));
    expect(((await getDataset("meta", config, EMPTY_FILTERS)) as { revisedWeeks: number }).revisedWeeks).toBe(0);
    rec.loadRevisionsChecked.mockResolvedValue({ revisions: [revision], failed: 0 });
    expect(((await getDataset("meta", config, EMPTY_FILTERS)) as { revisedWeeks: number }).revisedWeeks).toBe(1);
  });

  it("IS cached when every week read cleanly (the version-keyed saving still applies)", async () => {
    rec.loadRevisionsChecked.mockResolvedValue({ revisions: [revision], failed: 0 });
    await getDataset("meta", config, EMPTY_FILTERS);
    vi.advanceTimersByTime(60 * 60_000);
    await getDataset("meta", config, EMPTY_FILTERS);
    expect(rec.loadRevisionsChecked).toHaveBeenCalledTimes(1);
  });
});

describe("reconciliation history", () => {
  it("is not cached when a week of history could not be read", async () => {
    rec.loadRevisionsChecked.mockResolvedValue({ revisions: [], failed: 1 });
    await getDataset("reconciliation", config, EMPTY_FILTERS);
    await getDataset("reconciliation", config, EMPTY_FILTERS);
    expect(rec.loadRevisionsChecked).toHaveBeenCalledTimes(2);
  });

  it("IS cached when every week read cleanly", async () => {
    rec.loadRevisionsChecked.mockResolvedValue({ revisions: [], failed: 0 });
    await getDataset("reconciliation", config, EMPTY_FILTERS);
    await getDataset("reconciliation", config, EMPTY_FILTERS);
    expect(rec.loadRevisionsChecked).toHaveBeenCalledTimes(1);
  });
});
