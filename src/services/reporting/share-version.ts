// The Gold DATA VERSION of the Capricorn share: one cheap read that says "the data has moved", the
// timer that takes it, and the scope the dataset cache is keyed on. PBI 93610.
//
// Why. The share is rewritten by LoadGoldCapricornShare about four times a day. Everything the board
// shows is a pure function of that data and the London date, yet each dataset cache expired on a 45-60 s
// timer, so a wall rotating pages every 20 s kept re-asking Fabric for an answer it already had — and
// held the SQL endpoint allocated all day (~87 CU-h/day; the target is 11). The Reporting API did the
// same fix in PBI 93619: read a version hash of MAX(_etl_modified) and COUNT_BIG(*) per table and key
// the cache on it. This is that idea, over the eight tables THIS service reads.
//
// The version. One statement, one round trip: for each table the board queries, its newest load stamp
// and its row count, hashed. The stamp catches changed and added rows; the count catches a row that
// VANISHED, which cannot raise a watermark (the July 2026 week-drift case, domain/data-quality.ts, and
// _MortgageClient in the Reporting repo). Every table that any query under src/ reads is in the list —
// share-version.test.ts fails if a new one is added and not here.
//
// What it cannot see: an in-place update that does not advance the stamp (LoadGoldCapricornShare
// overwrites each table with Gold's own rows, so a Gold row is re-stamped when it changes, but `lender`
// has only `_etl_created`), and a delete paired with an insert that carries an older stamp. Neither is
// expected from the Gold merge; the 6 h cap on version-keyed entries (cache.ts) bounds it if one happens.
//
// When it is read. NOT per request: requests only ever look at the in-memory version (free). A timer
// reads it, steadily, every 10 minutes around the clock (REPORTING_VERSION_PROBE_SECONDS): ~144
// single-statement probes a day, against ~113,000 statements a day before. There is deliberately no
// schedule of "load windows". LoadGoldCapricornShare has no schedule of its own: it runs at the end of
// each DeltaLoad, which starts on the fapp's UTC extract slots but takes a variable number of hours, and
// there are extra off-slot runs (measured 21-23 Oct 2026: starts at 04:34, 10:02, 13:38, 16:35 and an
// evening catch-up at 23:14 UTC; the Aug-Sep windows would already have missed them). A steady cadence
// needs no model of it.
//
// A new version is not trusted at once. The share is copied table by table (6-8 minutes), so the first
// different reading can be a half-copied one. A different reading becomes a CANDIDATE: the cache keeps its
// current (complete) version while the candidate is re-probed every 2 minutes, and it is adopted only once
// it has held unchanged for 5 minutes. If it moves again the clock restarts; if it returns to the current
// version the candidate is dropped. The first reading after startup is adopted as the baseline.
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
// When it is read, and when a reading is believed
// ---------------------------------------------------------------------------

const MIN = 60_000;

/** Default steady probe cadence (REPORTING_VERSION_PROBE_SECONDS overrides it). */
export const DEFAULT_PROBE_INTERVAL_MS = 10 * MIN;
/** Re-probe cadence while a candidate version is waiting to be confirmed. */
export const PENDING_PROBE_MS = 2 * MIN;
/** A candidate version is adopted once it has held unchanged for this long (the copy takes 6-8 min). */
export const CONFIRM_MS = 5 * MIN;
/** Retry delay after a failed probe. */
export const FAILED_PROBE_RETRY_MS = 5 * MIN;
/** How long past its scheduled next probe a version is still trusted: four failed 5-minute retries. */
export const TRUST_GRACE_MS = 20 * MIN;

// ---------------------------------------------------------------------------
// The watcher
// ---------------------------------------------------------------------------

export interface ShareVersionState {
  /** The adopted (trusted-if-fresh) version, or null before the first successful probe. */
  version: string | null;
  /** When it was last READ, epoch ms (any successful probe). */
  checkedAt: number | null;
  /** When the adopted version last CHANGED (epoch ms); null if it has not changed since startup. */
  lastChangeAt: number | null;
  /** When the current unconfirmed candidate was first seen (epoch ms), or null if there is none. */
  candidateSince: number | null;
  /** The latest probe failure; cleared by the next success. */
  lastError: string | null;
}

export interface ShareVersionWatcher {
  stop: () => void;
  getState: () => ShareVersionState;
  /** The adopted version, only while it can still be vouched for; null otherwise. */
  trustedVersion: () => string | null;
  /** What the dataset cache keys on: `<version>|<London date>`, or null when there is no trusted version. */
  cacheScope: () => string | null;
}

interface Candidate {
  version: string;
  parts: Record<string, string>;
  since: number;
}

/** Start the background probe. Never throws. The first probe runs at once; until it succeeds the cache
 *  scope is null and the board is on wall-clock TTLs. */
export function startShareVersionWatcher(config: Config): ShareVersionWatcher {
  const pool = { server: config.fabric.endpoint, database: config.fabric.database };
  const query = buildVersionQuery();
  const configured = config.reporting.versionProbeSeconds;
  const intervalMs =
    configured > 0 && Number.isFinite(configured) ? Math.max(30_000, configured * 1000) : DEFAULT_PROBE_INTERVAL_MS;

  let version: string | null = null;
  let parts: Record<string, string> = {};
  let candidate: Candidate | null = null;
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
      // One retry: between loads this is nearly the only statement Fabric sees, so it is usually the
      // cold first hit after idle (a dropped socket is retried once, on a fresh pool).
      const reading = versionOf(await run<VersionRow>(pool, query, { retries: 1 }));
      const now = Date.now();

      if (version === null) {
        version = reading.version; // first reading after startup: the baseline
        parts = reading.parts;
      } else if (reading.version === version) {
        candidate = null; // nothing new, or a candidate that went back to what we have
      } else if (candidate && candidate.version === reading.version) {
        if (now - candidate.since >= CONFIRM_MS) {
          logger.info("Gold data version changed", {
            from: version,
            to: reading.version,
            tables: Object.keys(reading.parts).filter((t) => reading.parts[t] !== parts[t]),
            confirmedAfterMs: now - candidate.since,
          });
          version = reading.version;
          parts = reading.parts;
          lastChangeAt = now;
          candidate = null;
        }
      } else {
        // A new, or still-moving, reading: do not believe it until it has held still.
        candidate = { version: reading.version, parts: reading.parts, since: now };
      }

      if (untrustedLogged) logger.info("Gold data version readable again — dataset cache keyed on it", { version });
      untrustedLogged = false;
      checkedAt = now;
      lastError = null;
      const delay = candidate ? PENDING_PROBE_MS : intervalMs;
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
      schedule(Math.min(FAILED_PROBE_RETRY_MS, candidate ? PENDING_PROBE_MS : intervalMs));
    }
  };

  const trustedVersion = (): string | null => (version !== null && Date.now() <= trustedUntil ? version : null);

  void probe();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    getState: () => ({ version, checkedAt, lastChangeAt, candidateSince: candidate?.since ?? null, lastError }),
    trustedVersion,
    cacheScope: () => {
      const v = trustedVersion();
      return v === null ? null : `${v}|${tzToday(new Date(), config.reporting.timeZone)}`;
    },
  };
}
