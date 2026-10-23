// The Gold DATA VERSION of the Capricorn share: one cheap read that says "the data has moved", the
// timer that takes it, and the scope the dataset cache is keyed on. PBI 93610.
//
// Why. The share is rewritten by LoadGoldCapricornShare four times a day. Everything the board shows
// is a pure function of that data and the London date, yet each dataset cache expired on a 45-60 s
// timer, so a wall rotating pages every 20 s kept re-asking Fabric for an answer it already had — and
// held the SQL endpoint allocated all day (~87 CU-h/day; the target is 11). The Reporting API did the
// same fix in PBI 93619: read a version hash of MAX(_etl_modified) and COUNT_BIG(*) per table and key
// the cache on it. This is that idea, over the eight tables THIS service reads.
//
// The version. One statement, one round trip: for each table the board queries, its newest load stamp
// and its row count, hashed. The stamp catches changed and added rows; the count catches a row that
// VANISHED, which cannot raise a watermark (the July 2026 week-drift case, domain/data-quality.ts, and
// _MortgageClient in the Reporting repo). Every table that any query in reporting/ or snapshots/ reads
// is in the list — share-version.test.ts fails if a new one is added there and not here.
//
// When it is read. NOT per request. Requests only ever look at the in-memory version (free). A timer
// reads it: every 10 minutes while a load is expected, then, once a load has landed and the version has
// held for a probe, not again until the next window; every 2 hours otherwise as a backstop for a
// drifted or missed load. About 45 probes a day, against ~113,000 statements a day before.
//
//   LOAD WINDOWS, UTC, from the end times of the 92 LoadGoldCapricornShare runs 25 Aug-24 Sep 2026
//   (evidence: ro10-growthos-polling.md §5: 05:11-06:09, 08:31-11:20, 13:49-14:50, 16:54-17:55),
//   widened by ~10-15 min each side for the SQL endpoint's sync lag (7-8 min) and schedule drift.
//   UTC, not London: the schedule is fixed in UTC, so it does not move when the clocks change. If the
//   schedule moves, the 2-hour backstop still catches each load within 2 hours, and these constants
//   are the one thing to edit.
//
// Failure. A probe that fails is logged and retried in 5 minutes; it never throws and never touches the
// cache. The last good version stays trusted for one scheduled interval plus a grace; after that
// `cacheScope()` returns null and the cache goes back to its wall-clock TTLs, so the board keeps serving
// whatever Fabric will give it exactly as it did before this change.

import { createHash } from "node:crypto";
import type { Config } from "../../config.js";
import { logger } from "../logger.js";
import { tzToday } from "./pace.js";
import { run, type BuiltQuery } from "./query.js";

// ---------------------------------------------------------------------------
// What the version is read from
// ---------------------------------------------------------------------------

/** Every dbo table the board's queries read, with the load-stamp column it is known to carry.
 *  `lender` is global reference data copied whole and has no `_etl_modified`; its `_etl_created` plus
 *  its row count is the best it offers. (Columns per the Gold semantic model; mortgagecase's
 *  `_etl_modified` is the one datasets.ts `lastRefreshAt` already reads in production.) */
export const VERSION_TABLES: ReadonlyArray<{ table: string; stamp: "_etl_modified" | "_etl_created" }> = [
  { table: "mortgagecase", stamp: "_etl_modified" },
  { table: "protectioncase", stamp: "_etl_modified" },
  { table: "protectioncaseclient", stamp: "_etl_modified" },
  { table: "generalinsurancecase", stamp: "_etl_modified" },
  { table: "generalinsurancecaseclient", stamp: "_etl_modified" },
  { table: "useraccount", stamp: "_etl_modified" },
  { table: "introducer", stamp: "_etl_modified" },
  { table: "lender", stamp: "_etl_created" },
];

/** The whole version read as one statement (UNION ALL of per-table aggregates, the shape the Reporting
 *  API's freshness scan runs in production). No parameters, no firm filter: the share holds only the
 *  Capricorn firms, and a version over the whole table is the conservative one. */
export function buildVersionQuery(): BuiltQuery {
  const text = VERSION_TABLES.map(
    ({ table, stamp }) =>
      `SELECT '${table}' AS tbl, MAX([${stamp}]) AS mx, COUNT_BIG(*) AS n FROM dbo.${table}`,
  ).join("\nUNION ALL\n");
  return { text: `${text};`, params: [] };
}

export interface VersionRow {
  tbl: string;
  mx: unknown;
  n: unknown;
}

function stampOf(v: unknown): string {
  if (v == null) return "-";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "-" : v.toISOString();
  const parsed = new Date(String(v));
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

/** Fold the per-table rows into one short version. `parts` keeps each table's own reading so a change
 *  can be logged by table. Throws if any table is missing: a version minted from part of the lake
 *  would look like a change (or, worse, like no change). */
export function versionOf(rows: VersionRow[]): { version: string; parts: Record<string, string> } {
  const byTable = new Map(rows.map((r) => [String(r.tbl).toLowerCase(), r]));
  const parts: Record<string, string> = {};
  for (const { table } of VERSION_TABLES) {
    const row = byTable.get(table);
    if (!row) throw new Error(`Gold version read incomplete: no row for dbo.${table}`);
    parts[table] = `${stampOf(row.mx)}/${row.n == null ? "-" : String(row.n)}`;
  }
  const canonical = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join(";");
  return { version: createHash("sha256").update(canonical).digest("hex").slice(0, 16), parts };
}

// ---------------------------------------------------------------------------
// When it is read
// ---------------------------------------------------------------------------

const MIN = 60_000;

/** Probe cadence while a load is expected and has not yet landed and settled. */
export const IN_WINDOW_PROBE_MS = 10 * MIN;
/** Backstop cadence outside the windows (and once a window's load has settled). */
export const OUTSIDE_WINDOW_PROBE_MS = 120 * MIN;
/** After a change, the version must hold this long (one confirming probe) before probing goes quiet:
 *  the share is copied table by table, so the first new version can be a half-copied one. */
export const SETTLE_MS = 10 * MIN;
/** Retry delay after a failed probe. */
export const FAILED_PROBE_RETRY_MS = 5 * MIN;
/** How long past its scheduled next probe a version is still trusted. Two missed retries. */
export const TRUST_GRACE_MS = 20 * MIN;
const MIN_PROBE_DELAY_MS = 1_000;

/** [open, close) in minutes after 00:00 UTC. */
const LOAD_WINDOWS_UTC_MINUTES: ReadonlyArray<readonly [number, number]> = [
  [5 * 60, 6 * 60 + 30], //          05:00-06:30
  [8 * 60 + 15, 11 * 60 + 45], //    08:15-11:45
  [13 * 60 + 30, 15 * 60 + 15], //   13:30-15:15
  [16 * 60 + 30, 18 * 60 + 15], //   16:30-18:15
];

const DAY_MS = 24 * 60 * MIN;

function windowAt(nowMs: number): { startMs: number } | null {
  const dayStart = nowMs - (((nowMs % DAY_MS) + DAY_MS) % DAY_MS);
  for (const [open, close] of LOAD_WINDOWS_UTC_MINUTES) {
    const startMs = dayStart + open * MIN;
    if (nowMs >= startMs && nowMs < dayStart + close * MIN) return { startMs };
  }
  return null;
}

function nextWindowOpenMs(nowMs: number): number {
  const dayStart = nowMs - (((nowMs % DAY_MS) + DAY_MS) % DAY_MS);
  for (const [open] of LOAD_WINDOWS_UTC_MINUTES) {
    if (dayStart + open * MIN > nowMs) return dayStart + open * MIN;
  }
  return dayStart + DAY_MS + LOAD_WINDOWS_UTC_MINUTES[0][0] * MIN;
}

/** How long to wait before the next probe, given the time and when the version last CHANGED (ms, or
 *  null if it has not changed since this process started). Pure, so the schedule is testable. */
export function nextProbeDelayMs(nowMs: number, lastChangeMs: number | null): number {
  const w = windowAt(nowMs);
  if (w) {
    const settled = lastChangeMs != null && lastChangeMs >= w.startMs && nowMs - lastChangeMs >= SETTLE_MS;
    if (!settled) return IN_WINDOW_PROBE_MS;
  }
  const untilNextWindow = nextWindowOpenMs(nowMs) - nowMs;
  return Math.max(MIN_PROBE_DELAY_MS, Math.min(OUTSIDE_WINDOW_PROBE_MS, untilNextWindow));
}

// ---------------------------------------------------------------------------
// The watcher
// ---------------------------------------------------------------------------

export interface ShareVersionState {
  /** Last good version, or null before the first successful probe. */
  version: string | null;
  /** When it was read (epoch ms). */
  checkedAt: number | null;
  /** When it last CHANGED (epoch ms); null if it has not changed since startup (the first read is a baseline). */
  lastChangeAt: number | null;
  /** The latest probe failure; cleared by the next success. */
  lastError: string | null;
}

export interface ShareVersionWatcher {
  stop: () => void;
  getState: () => ShareVersionState;
  /** The version, only while it can still be vouched for; null otherwise. */
  trustedVersion: () => string | null;
  /** What the dataset cache keys on: `<version>|<London date>`, or null when there is no trusted version. */
  cacheScope: () => string | null;
}

/** Start the background probe. Never throws. The first probe runs at once; until it succeeds the cache
 *  scope is null and the board is on wall-clock TTLs. */
export function startShareVersionWatcher(config: Config): ShareVersionWatcher {
  const pool = { server: config.fabric.endpoint, database: config.fabric.database };
  const query = buildVersionQuery();

  let version: string | null = null;
  let parts: Record<string, string> = {};
  let checkedAt: number | null = null;
  let lastChangeAt: number | null = null;
  let lastError: string | null = null;
  let trustedUntil = 0;
  let untrustedLogged = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void probe(), delayMs);
    timer.unref?.();
  };

  const probe = async (): Promise<void> => {
    try {
      const next = versionOf(await run<VersionRow>(pool, query, { retries: 0 }));
      const now = Date.now();
      if (version !== null && next.version !== version) {
        lastChangeAt = now;
        logger.info("Gold data version changed", {
          from: version,
          to: next.version,
          tables: Object.keys(next.parts).filter((t) => next.parts[t] !== parts[t]),
        });
      }
      if (untrustedLogged) logger.info("Gold data version readable again — dataset cache keyed on it", { version: next.version });
      untrustedLogged = false;
      version = next.version;
      parts = next.parts;
      checkedAt = now;
      lastError = null;
      const delay = nextProbeDelayMs(now, lastChangeAt);
      trustedUntil = now + delay + TRUST_GRACE_MS;
      schedule(delay);
    } catch (err) {
      lastError = String((err as Error)?.message ?? err);
      const now = Date.now();
      logger.warn("Gold data version probe failed — keeping the last good version", { err: lastError });
      if (version !== null && now > trustedUntil && !untrustedLogged) {
        untrustedLogged = true;
        logger.warn("Gold data version no longer trusted — dataset cache is back on wall-clock TTLs");
      }
      schedule(Math.min(FAILED_PROBE_RETRY_MS, nextProbeDelayMs(now, lastChangeAt)));
    }
  };

  const trustedVersion = (): string | null => (version !== null && Date.now() <= trustedUntil ? version : null);

  void probe();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    getState: () => ({ version, checkedAt, lastChangeAt, lastError }),
    trustedVersion,
    cacheScope: () => {
      const v = trustedVersion();
      return v === null ? null : `${v}|${tzToday(new Date(), config.reporting.timeZone)}`;
    },
  };
}
