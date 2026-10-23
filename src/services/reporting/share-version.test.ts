// PBI 93610 — the Gold data version: what it is read from, when it is probed, and when it is trusted.
//
// The version is the one cheap signal that says "the Capricorn copy of Gold has moved". Everything the
// wall shows is a pure function of (that data, the London date), so the dataset cache is keyed on it.
// What these tests pin:
//   - the version is built from the tables the board really reads (a guard that fails when a new
//     table is queried and nobody adds it here),
//   - it moves on a changed row, a removed row and a different load stamp,
//   - probes happen densely only while a load is expected and sparsely otherwise,
//   - a failing probe never throws and, once it has failed long enough, stops being trusted so the
//     cache falls back to wall-clock TTLs.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";

const lake: { rows: unknown[]; fail: boolean; calls: string[] } = { rows: [], fail: false, calls: [] };

vi.mock("./query.js", () => ({
  run: vi.fn(async (_pool: unknown, q: { text: string }) => {
    lake.calls.push(q.text);
    if (lake.fail) throw new Error("ECONNRESET simulated");
    return lake.rows;
  }),
}));

import {
  FAILED_PROBE_RETRY_MS,
  IN_WINDOW_PROBE_MS,
  OUTSIDE_WINDOW_PROBE_MS,
  SETTLE_MS,
  TRUST_GRACE_MS,
  VERSION_TABLES,
  buildVersionQuery,
  nextProbeDelayMs,
  startShareVersionWatcher,
  versionOf,
  type ShareVersionWatcher,
} from "./share-version.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const utc = (hhmm: string, day = "2026-10-23") => Date.parse(`${day}T${hhmm}:00Z`);

const config = {
  fabric: { endpoint: "x.datawarehouse.fabric.microsoft.com", database: "GAGold_Capricorn" },
  reporting: { timeZone: "Europe/London" },
} as unknown as Config;

/** One version-query result set: every table at the same stamp and count unless overridden. */
function goldRows(over: Record<string, { mx?: unknown; n?: unknown }> = {}) {
  return VERSION_TABLES.map(({ table }) => ({
    tbl: table,
    mx: new Date("2026-10-23T05:44:00.000Z"),
    n: 1000,
    ...over[table],
  }));
}

describe("what the version is read from", () => {
  it("probes every table the board reads, in ONE statement", () => {
    const q = buildVersionQuery();
    for (const { table } of VERSION_TABLES) expect(q.text).toContain(`dbo.${table}`);
    expect(q.text.match(/COUNT_BIG\(\*\)/g)).toHaveLength(VERSION_TABLES.length);
    expect(q.params).toEqual([]);
    expect(q.text.trim().endsWith(";")).toBe(true);
  });

  it("covers every dbo table any production query reads (so a new table cannot be forgotten)", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    for (const dir of ["reporting", "snapshots"]) {
      for (const f of readdirSync(join(root, dir))) {
        const p = join(root, dir, f);
        if (statSync(p).isFile() && f.endsWith(".ts") && !f.endsWith(".test.ts")) files.push(p);
      }
    }
    const read = new Set<string>();
    for (const p of files) {
      if (p.endsWith("share-version.ts")) continue;
      // Code only: prose in comments names Silver tables and three-part names that are not reads.
      const code = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/(?<![\w.])dbo\.([a-z_]+)/gi)) read.add(m[1].toLowerCase());
    }
    expect(read.size).toBeGreaterThanOrEqual(8); // the scan itself found the board's tables
    const covered = new Set(VERSION_TABLES.map((t) => t.table));
    expect([...read].filter((t) => !covered.has(t))).toEqual([]);
  });

  it("uses a stamp column each table is known to have (lender has no _etl_modified)", () => {
    const lender = VERSION_TABLES.find((t) => t.table === "lender");
    expect(lender?.stamp).toBe("_etl_created");
    expect(VERSION_TABLES.find((t) => t.table === "mortgagecase")?.stamp).toBe("_etl_modified");
  });
});

describe("versionOf", () => {
  it("is stable for the same data, whatever order the rows arrive in", () => {
    const a = versionOf(goldRows());
    const b = versionOf([...goldRows()].reverse());
    expect(a.version).toBe(b.version);
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("moves when a table's load stamp moves", () => {
    const before = versionOf(goldRows()).version;
    const after = versionOf(goldRows({ protectioncase: { mx: new Date("2026-10-23T11:20:00.000Z") } })).version;
    expect(after).not.toBe(before);
  });

  it("moves when a row VANISHES (same stamp, lower count) — a removed row cannot raise a watermark", () => {
    const before = versionOf(goldRows()).version;
    const after = versionOf(goldRows({ mortgagecase: { n: 999 } })).version;
    expect(after).not.toBe(before);
  });

  it("reads counts the driver returns as strings (bigint) and stamps returned as strings", () => {
    const asDates = versionOf(goldRows({ mortgagecase: { mx: new Date("2026-10-23T05:44:00.000Z"), n: 1000 } }));
    const asStrings = versionOf(goldRows({ mortgagecase: { mx: "2026-10-23T05:44:00.000Z", n: "1000" } }));
    expect(asStrings.version).toBe(asDates.version);
  });

  it("names the tables that differ between two reads, for the audit log", () => {
    const a = versionOf(goldRows());
    const b = versionOf(goldRows({ useraccount: { n: 1001 }, lender: { n: 5 } }));
    expect(Object.keys(b.parts).filter((k) => a.parts[k] !== b.parts[k]).sort()).toEqual(["lender", "useraccount"]);
  });

  it("refuses an incomplete read rather than minting a version from part of the lake", () => {
    expect(() => versionOf(goldRows().slice(1))).toThrow(/incomplete/i);
    expect(() => versionOf([])).toThrow(/incomplete/i);
  });
});

describe("nextProbeDelayMs — dense while a load is expected, sparse otherwise", () => {
  // Load windows (UTC), widened past the measured end times of LoadGoldCapricornShare for 25 Aug-24 Sep
  // plus the endpoint's sync lag: 05:00-06:30, 08:15-11:45, 13:30-15:15, 16:30-18:15.
  it("probes every 10 minutes inside a window until a load has landed", () => {
    expect(nextProbeDelayMs(utc("05:30"), null)).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("10:00"), null)).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("14:00"), null)).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("17:00"), null)).toBe(IN_WINDOW_PROBE_MS);
    expect(IN_WINDOW_PROBE_MS).toBe(10 * MIN);
  });

  it("window edges: open at the start, closed at the end", () => {
    expect(nextProbeDelayMs(utc("05:00"), null)).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("06:30"), null)).not.toBe(IN_WINDOW_PROBE_MS);
  });

  it("keeps probing at the dense cadence right after a change, until the version has SETTLED", () => {
    // A change just seen: the share copies tables over several minutes, so the first new version may be
    // a half-copied one. Do not go quiet until a probe at least SETTLE_MS later still agrees.
    expect(nextProbeDelayMs(utc("10:50"), utc("10:47"))).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("10:56"), utc("10:47"))).toBe(IN_WINDOW_PROBE_MS); // 9 min: not yet settled
    expect(SETTLE_MS).toBe(10 * MIN);
  });

  it("goes quiet once settled — it does not keep probing the rest of the window", () => {
    // Change seen 10:47, confirmed unchanged by the probe at 10:57; next window opens 13:30 (2h33 away),
    // so the backstop cadence applies.
    expect(nextProbeDelayMs(utc("10:57"), utc("10:47"))).toBe(OUTSIDE_WINDOW_PROBE_MS);
    expect(OUTSIDE_WINDOW_PROBE_MS).toBe(2 * HOUR);
  });

  it("a change from an earlier window does not settle the current one", () => {
    expect(nextProbeDelayMs(utc("05:30"), utc("17:17", "2026-10-22"))).toBe(IN_WINDOW_PROBE_MS);
    expect(nextProbeDelayMs(utc("10:30"), utc("05:29"))).toBe(IN_WINDOW_PROBE_MS);
  });

  it("outside a window, backs off to the backstop cadence but wakes for the next window opening", () => {
    expect(nextProbeDelayMs(utc("19:00"), null)).toBe(OUTSIDE_WINDOW_PROBE_MS); // next open is tomorrow 05:00
    expect(nextProbeDelayMs(utc("07:00"), null)).toBe(75 * MIN); // wakes for 08:15, not 2h later
    expect(nextProbeDelayMs(utc("08:10"), null)).toBe(5 * MIN);
    expect(nextProbeDelayMs(utc("12:00"), null)).toBe(90 * MIN); // wakes for 13:30
  });

  it("never returns a zero or negative delay", () => {
    for (let m = 0; m < 24 * 60; m++) {
      expect(nextProbeDelayMs(utc("00:00") + m * MIN, null)).toBeGreaterThan(0);
    }
  });
});

describe("startShareVersionWatcher", () => {
  let watcher: ShareVersionWatcher | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z")); // inside window B
    lake.rows = goldRows();
    lake.fail = false;
    lake.calls = [];
  });

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("has no scope until the first probe succeeds (so the cache stays time-based at boot)", async () => {
    watcher = startShareVersionWatcher(config);
    expect(watcher.cacheScope()).toBeNull();
    await flush();
    expect(watcher.cacheScope()).toMatch(/^[0-9a-f]{16}\|2026-10-23$/);
    expect(watcher.trustedVersion()).toMatch(/^[0-9a-f]{16}$/);
    expect(lake.calls).toHaveLength(1);
    expect(lake.calls[0]).toBe(buildVersionQuery().text);
  });

  it("puts the LONDON date in the scope, not the UTC one (23:30Z in BST is already tomorrow)", async () => {
    vi.setSystemTime(new Date("2026-10-23T23:30:00Z"));
    watcher = startShareVersionWatcher(config);
    await flush();
    expect(watcher.cacheScope()).toMatch(/\|2026-10-24$/);
  });

  it("changes the scope when the lake moves, and records when", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    expect(watcher.getState().lastChangeAt).toBeNull(); // the first read is a baseline, not a change

    lake.rows = goldRows({ mortgagecase: { mx: new Date("2026-10-23T09:05:00.000Z"), n: 1004 } });
    await vi.advanceTimersByTimeAsync(IN_WINDOW_PROBE_MS);
    expect(watcher.cacheScope()).not.toBe(before);
    expect(watcher.getState().lastChangeAt).toBe(Date.now());
  });

  it("leaves the scope alone when a probe finds nothing new", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    await vi.advanceTimersByTimeAsync(IN_WINDOW_PROBE_MS);
    await vi.advanceTimersByTimeAsync(IN_WINDOW_PROBE_MS);
    expect(lake.calls).toHaveLength(3);
    expect(watcher.cacheScope()).toBe(before);
    expect(watcher.getState().lastChangeAt).toBeNull();
  });

  it("a failing probe never throws, keeps the last good version and records the error", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    lake.fail = true;
    await vi.advanceTimersByTimeAsync(IN_WINDOW_PROBE_MS);
    expect(watcher.cacheScope()).toBe(before); // still trusted: one miss must not send the wall back to polling
    expect(watcher.getState().lastError).toMatch(/ECONNRESET/);
  });

  it("stops trusting the version once probes have failed for longer than it can vouch for", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    lake.fail = true;
    // Last good probe at 09:00 scheduled the next one 10 min out; trusted until that plus the grace.
    await vi.advanceTimersByTimeAsync(IN_WINDOW_PROBE_MS + TRUST_GRACE_MS - MIN);
    expect(watcher.cacheScope()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(watcher.cacheScope()).toBeNull(); // cache is back on wall-clock TTLs
    expect(watcher.trustedVersion()).toBeNull();
  });

  it("retries a failed probe soon, not at the backstop cadence", async () => {
    vi.setSystemTime(new Date("2026-10-23T19:00:00Z")); // outside every window: backstop is 2h
    lake.fail = true;
    watcher = startShareVersionWatcher(config);
    await flush();
    expect(lake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FAILED_PROBE_RETRY_MS);
    expect(lake.calls).toHaveLength(2);
  });

  it("recovers: the next good probe restores the scope", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    lake.fail = true;
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(watcher.cacheScope()).toBeNull();
    lake.fail = false;
    await vi.advanceTimersByTimeAsync(FAILED_PROBE_RETRY_MS);
    expect(watcher.cacheScope()).not.toBeNull();
    expect(watcher.getState().lastError).toBeNull();
  });

  it("a malformed read (missing tables) is a failed probe, not a version", async () => {
    lake.rows = goldRows().slice(0, 3);
    watcher = startShareVersionWatcher(config);
    await flush();
    expect(watcher.cacheScope()).toBeNull();
    expect(watcher.getState().lastError).toMatch(/incomplete/i);
  });

  it("stop() ends the probing", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    watcher.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(lake.calls).toHaveLength(1);
  });

  it("a whole day costs a few dozen probes, and every load reaches the cache within one probe interval", async () => {
    // The loads land at the measured p50 end times of LoadGoldCapricornShare (25 Aug-24 Sep, UTC):
    // 05:29, 10:47, 14:16, 17:17. The wall is 'open all day' (cacheScope is read every minute).
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    const landings = ["05:29", "10:47", "14:16", "17:17"].map((t) => utc(t));
    let loaded = 0;

    const stampFor = (n: number) => new Date(utc("00:00") + n * HOUR);
    const setLake = () => {
      lake.rows = goldRows({ mortgagecase: { mx: stampFor(loaded), n: 1000 + loaded } });
    };
    setLake();
    watcher = startShareVersionWatcher(config);
    const seenAt: number[] = [];
    let lastVersion: string | null = null;

    for (let m = 0; m < 24 * 60; m++) {
      const now = utc("00:00") + m * MIN;
      if (loaded < landings.length && now >= landings[loaded]) {
        loaded++;
        setLake();
      }
      await vi.advanceTimersByTimeAsync(MIN);
      // The VERSION, not the scope: the scope also moves at London midnight, which is not a load.
      const v = watcher.trustedVersion();
      if (lastVersion !== null && v !== lastVersion) seenAt.push(Date.now());
      lastVersion = v;
    }

    expect(seenAt).toHaveLength(4);
    seenAt.forEach((seen, i) => {
      const lag = seen - landings[i];
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(IN_WINDOW_PROBE_MS + MIN); // 'within minutes'
    });
    // Today's polling is ~113,000 statements a day; this is the whole of the version traffic.
    expect(lake.calls.length).toBeLessThan(60);
    expect(lake.calls.length).toBeGreaterThan(20); // and it is not accidentally idle
  });
});
