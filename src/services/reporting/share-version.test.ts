// PBI 93610 — the Gold data version: what it is read from, when it is probed, and when it is trusted.
//
// The version is the one cheap signal that says "the Capricorn copy of Gold has moved". Everything the
// wall shows is a pure function of (that data, the London date), so the dataset cache is keyed on it.
// What these tests pin:
//   - the version is built from the tables the board really reads (a guard that fails when a new
//     table is queried and nobody adds it here),
//   - it moves on a changed row, a removed row and a different load stamp,
//   - it is probed steadily, and a new reading is only believed once it has held still (the share is
//     copied table by table),
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
  CONFIRM_MS,
  FAILED_PROBE_RETRY_MS,
  PENDING_PROBE_MS,
  TRUST_GRACE_MS,
  VERSION_TABLES,
  buildVersionQuery,
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

/** Every .ts file under src/ that is production code and not this module. */
function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...productionSources(p));
    else if (f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "share-version.ts") out.push(p);
  }
  return out;
}

/** The SQL-bearing text of a source file: block comments and line comments removed (a `//` only counts
 *  as a comment at the start of a line or after whitespace, so 'http://x' inside a string survives). */
function codeOf(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("what the version is read from", () => {
  it("is ONE statement: a UNION ALL of per-table aggregates, no parameters", () => {
    const q = buildVersionQuery();
    expect(q.text.match(/COUNT_BIG\(\*\)/g)).toHaveLength(VERSION_TABLES.length);
    expect(q.text.match(/UNION ALL/g)).toHaveLength(VERSION_TABLES.length - 1);
    expect(q.text.match(/;/g)).toHaveLength(1);
    expect(q.text.trim().endsWith(";")).toBe(true);
    expect(q.params).toEqual([]);
  });

  it("reads each table's own stamp column — lender has no _etl_modified, so it uses _etl_created", () => {
    const text = buildVersionQuery().text;
    expect(text).toContain("SELECT 'mortgagecase' AS tbl, MAX([_etl_modified]) AS mx, COUNT_BIG(*) AS n FROM dbo.mortgagecase");
    expect(text).toContain("SELECT 'lender' AS tbl, MAX([_etl_created]) AS mx, COUNT_BIG(*) AS n FROM dbo.lender");
  });

  it("covers every table any production query under src/ reads, so a new one cannot be forgotten", () => {
    const covered = new Set(VERSION_TABLES.map((t) => t.table));
    const read = new Set<string>();
    const unqualified: string[] = [];
    const root = join(__dirname, "..", "..");
    const sources = productionSources(root).map((path) => ({ path, code: codeOf(path) }));
    // CTE names are collected across all files: a shared WITH clause is built in one module and used in others.
    const ctes = new Set(
      sources.flatMap(({ code }) => [...code.matchAll(/(?:\bWITH\s+|,\s*|`\s*)(\w+)\s+AS\s*\(/g)].map((m) => m[1].toLowerCase())),
    );

    for (const { path, code } of sources) {
      // [dbo].[x], dbo.x and GAGold_Capricorn.dbo.x
      for (const m of code.matchAll(/\[?dbo\]?\.\[?(\w+)\]?/gi)) read.add(m[1].toLowerCase());
      // A table name built at run time cannot be checked statically.
      if (/\bdbo\.\$\{/i.test(code)) unqualified.push(`${path}: dbo.\${...}`);
      // Any FROM/JOIN target must be dbo-qualified, a ${spec.table} that resolves to a dbo literal read
      // above, or a CTE defined anywhere under src/.
      for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+([^\s,(;)]+)/g)) {
        const target = m[1];
        if (/^\[?dbo\]?\./i.test(target) || target.startsWith("${") || ctes.has(target.toLowerCase())) continue;
        if (/^[A-Za-z_]\w*\.\[?dbo\]?\./i.test(target)) continue; // db.dbo.table
        unqualified.push(`${path}: FROM/JOIN ${target}`);
      }
    }

    expect(read.size).toBeGreaterThanOrEqual(8); // the scan itself found the board's tables
    expect(unqualified).toEqual([]);
    expect([...read].filter((t) => !covered.has(t))).toEqual([]);
  });

  it("the scan would notice a table that is missing (self-check of the guard)", () => {
    const snippet = "SELECT 1 FROM [dbo].[newtable] n JOIN GAGold_Capricorn.dbo.other o ON 1=1 JOIN dbo.mortgagecase m ON 1=1";
    const found = [...snippet.matchAll(/\[?dbo\]?\.\[?(\w+)\]?/gi)].map((m) => m[1]);
    expect(found).toEqual(["newtable", "other", "mortgagecase"]);
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

describe("startShareVersionWatcher", () => {
  let watcher: ShareVersionWatcher | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));
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
  /** A load lands: every row of one table moves to a new stamp and count. */
  const land = (table: string, n: number) => {
    lake.rows = goldRows({ ...Object.fromEntries(landed), [table]: { mx: new Date("2026-10-23T10:00:00.000Z"), n } });
    landed.set(table, { mx: new Date("2026-10-23T10:00:00.000Z"), n });
  };
  const landed = new Map<string, { mx: Date; n: number }>();
  beforeEach(() => landed.clear());

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

  it("probes steadily around the clock: no windows, whatever the hour", async () => {
    for (const start of ["2026-10-23T03:00:00Z", "2026-10-23T19:00:00Z", "2026-10-23T10:07:00Z"]) {
      lake.calls = [];
      vi.setSystemTime(new Date(start));
      const w = startShareVersionWatcher(config);
      await vi.advanceTimersByTimeAsync(HOUR);
      w.stop();
      expect(lake.calls).toHaveLength(7); // at boot, then every 10 minutes
    }
  });

  it("honours a configured probe interval, with a 30 s floor", async () => {
    const at = (seconds: number) => ({ ...config, reporting: { ...config.reporting, versionProbeSeconds: seconds } }) as Config;
    watcher = startShareVersionWatcher(at(300));
    await vi.advanceTimersByTimeAsync(HOUR);
    watcher.stop();
    expect(lake.calls).toHaveLength(13);

    lake.calls = [];
    watcher = startShareVersionWatcher(at(1));
    await vi.advanceTimersByTimeAsync(5 * MIN);
    watcher.stop();
    expect(lake.calls).toHaveLength(11); // floor of 30 s, not 1 s
  });

  it("does not believe a new reading at once: the cache keeps the old complete version while it is confirmed", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();

    land("mortgagecase", 1004);
    await vi.advanceTimersByTimeAsync(10 * MIN); // the steady probe sees it
    expect(watcher.cacheScope()).toBe(before); // candidate only
    expect(watcher.getState().candidateSince).toBe(Date.now());

    await vi.advanceTimersByTimeAsync(PENDING_PROBE_MS);
    expect(watcher.cacheScope()).toBe(before); // 2 min of agreement is not enough
    const candidateSince = watcher.getState().candidateSince!;
    await vi.advanceTimersByTimeAsync(CONFIRM_MS);
    expect(watcher.cacheScope()).not.toBe(before); // held unchanged for CONFIRM_MS: adopted
    expect(watcher.getState().lastChangeAt).toBeGreaterThanOrEqual(candidateSince + CONFIRM_MS);
    expect(watcher.getState().lastChangeAt).toBeLessThanOrEqual(Date.now());
    expect(watcher.getState().candidateSince).toBeNull();
  });

  it("re-probes every 2 minutes while a candidate waits, then returns to the steady cadence", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    land("mortgagecase", 1004);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    lake.calls = [];
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + MIN); // adopted at +6 min
    expect(lake.calls.length).toBe(3); // +2, +4, +6
    lake.calls = [];
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(lake.calls.length).toBe(6);
  });

  it("a half-copied load never reaches the cache: the reading keeps moving, so nothing is adopted until it stops", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    const seen = new Set<string | null>([before]);

    // The share is copied table by table: a different table lands every 90 s, starting a minute before a
    // steady probe, so probes read the share mid-copy.
    await vi.advanceTimersByTimeAsync(9 * MIN);
    const tables = ["mortgagecase", "protectioncase", "useraccount", "introducer"];
    for (let i = 0; i < tables.length; i++) {
      land(tables[i], 2000 + i);
      await vi.advanceTimersByTimeAsync(90_000);
      seen.add(watcher.cacheScope());
    }
    expect(lake.calls.length).toBeGreaterThanOrEqual(4); // probes did read it mid-copy
    expect(seen).toEqual(new Set([before])); // the old, complete version throughout the copy
    const lastLanding = Date.now() - 90_000;

    await vi.advanceTimersByTimeAsync(30 * MIN);
    const after = watcher.cacheScope();
    expect(after).not.toBe(before);
    // what was adopted is the finished state, not an intermediate one, and only after it held still
    expect(after!.split("|")[0]).toBe(versionOf(goldRows(Object.fromEntries(landed))).version);
    expect(watcher.getState().lastChangeAt).toBeGreaterThanOrEqual(lastLanding + CONFIRM_MS);
  });

  it("drops a candidate that goes back to the version already held", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    land("mortgagecase", 1004);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(watcher.getState().candidateSince).not.toBeNull();
    lake.rows = goldRows(); // the reading returns to what we hold
    landed.clear();
    await vi.advanceTimersByTimeAsync(PENDING_PROBE_MS);
    expect(watcher.getState().candidateSince).toBeNull();
    expect(watcher.cacheScope()).toBe(before);
    expect(watcher.getState().lastChangeAt).toBeNull();
  });

  it("leaves the scope alone when a probe finds nothing new", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(lake.calls).toHaveLength(3);
    expect(watcher.cacheScope()).toBe(before);
    expect(watcher.getState().lastChangeAt).toBeNull();
  });

  it("a failing probe never throws, keeps the last good version and records the error", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    const before = watcher.cacheScope();
    lake.fail = true;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(watcher.cacheScope()).toBe(before); // still trusted: one miss must not send the wall back to polling
    expect(watcher.getState().lastError).toMatch(/ECONNRESET/);
  });

  it("stops trusting the version once probes have failed for longer than it can vouch for", async () => {
    watcher = startShareVersionWatcher(config);
    await flush();
    lake.fail = true;
    // Last good probe at 09:00 scheduled the next one 10 min out; trusted until that plus the grace.
    await vi.advanceTimersByTimeAsync(10 * MIN + TRUST_GRACE_MS - MIN);
    expect(watcher.cacheScope()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(watcher.cacheScope()).toBeNull(); // cache is back on wall-clock TTLs
    expect(watcher.trustedVersion()).toBeNull();
  });

  it("retries a failed probe in 5 minutes, not at the steady cadence", async () => {
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

  it("a whole day: loads at the times measured on 21-23 Oct (04:34, 10:02, 13:38, 16:35, 23:14 UTC), each a 7-minute table-by-table copy, are all picked up and no half-copied state is ever adopted", async () => {
    // These are NOT the Aug-Sep 'windows': the share has no schedule, it runs when DeltaLoad finishes.
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    const starts = ["04:34", "10:02", "13:38", "16:35", "23:14"].map((t) => utc(t));
    const COPY_MIN = 7;
    const copied = ["mortgagecase", "protectioncase", "protectioncaseclient", "useraccount"];

    // The share as it stands `now`: each load rewrites one more of the tables every ~1.75 min.
    const shareAt = (now: number) => {
      const st: Record<string, { mx: Date; n: number }> = {};
      starts.forEach((start, li) => {
        const d = (now - start) / MIN;
        if (d < 0) return;
        const done = d >= COPY_MIN ? copied.length : Math.floor(d / (COPY_MIN / copied.length)) + 1;
        for (let i = 0; i < done; i++) st[copied[i]] = { mx: new Date(start + i * 100_000), n: 3000 + li * 10 + i };
      });
      return st;
    };
    const finalVersions = new Set<string>([versionOf(goldRows(shareAt(utc("00:00")))).version]);
    starts.forEach((start) => finalVersions.add(versionOf(goldRows(shareAt(start + COPY_MIN * MIN))).version));

    watcher = startShareVersionWatcher(config);
    const adopted: Array<{ at: number; version: string }> = [];
    let last: string | null = null;
    for (let m = 0; m < 24 * 60; m++) {
      const now = utc("00:00") + m * MIN;
      lake.rows = goldRows(shareAt(now));
      await vi.advanceTimersByTimeAsync(MIN);
      const v = watcher.trustedVersion();
      if (last !== null && v !== last) adopted.push({ at: Date.now(), version: v! });
      last = v;
    }

    expect(adopted).toHaveLength(5);
    adopted.forEach(({ at, version }, i) => {
      expect(finalVersions.has(version)).toBe(true); // the finished copy, never an intermediate state
      const lag = at - (starts[i] + COPY_MIN * MIN);
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(10 * MIN + CONFIRM_MS + 2 * MIN); // one probe interval plus the confirmation
    });
    // Today's polling is ~113,000 statements a day; this is the whole of the version traffic.
    expect(lake.calls.length).toBeGreaterThan(140);
    expect(lake.calls.length).toBeLessThan(200);
  });
});
