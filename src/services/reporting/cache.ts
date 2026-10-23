// In-memory cache for dataset payloads, keyed on the Gold DATA VERSION (PBI 93610) with a wall-clock
// TTL as the fallback.
//
// Why a version and not just a TTL. Every payload the board serves is a pure function of the Capricorn
// copy of Gold, the London date, the active targets and the week-snapshot blob. Gold changes about four
// times a day. A 45 s TTL against a wall that changes page every 20 s therefore re-queried Fabric on nearly
// every page change for data that had not moved — ~113k statements a day per screen, and the SQL
// endpoint held allocated around the clock (~87 CU-h/day against a target of 11).
//
// How it works. A scope provider (share-version.ts) says "the data is at version V on London date D".
//   - Scope known: an entry is a hit while its scope still equals the current one. It does not matter
//     how old it is; only a new version, a new date, or the safety cap (`versionedMaxAgeMs`, which
//     bounds anything the version cannot see) makes the next request reload it.
//   - Scope unknown (never probed, probe failing past its trust window, provider throws): the per-call
//     `ttlMs` applies exactly as it did before this change. The board never errors for want of a
//     version. (A version stays trusted for one probe interval plus a grace after its last good read,
//     so a short probe outage does not send the wall back to polling.)
// In-flight de-duplication is unchanged: concurrent requests for a key await one promise. Failures are
// NOT cached, and a loader can also refuse to have a degraded answer kept (`cacheable`).
//
// SINGLE INSTANCE: this cache, the active targets and the snapshot scheduler are all in-process, and
// clearCache() only reaches its own process. The App Service runs one worker (az webapp config show,
// 24 Sep 2026; the plan's instance count is not set in main.bicep); a second instance would not see an
// upload or a snapshot write made on the first until its own next version change or the safety cap.
// Targets were already per-process (hydrated from storage at boot only).

interface Entry {
  at: number;
  promise: Promise<unknown>;
  /** The scope this entry was STARTED under; null when no version was known. */
  scope: string | null;
}

/** "Which data are we on right now": a version plus the London date, or null when unknown. */
export type CacheScopeProvider = () => string | null;

/** Longest a versioned entry may be served, whatever the version says. 6 h: longer than any gap
 *  between Gold loads in the day, short enough that a change the version cannot see (a table outside
 *  the probe, a schema change) is still picked up the same working day. */
export const DEFAULT_VERSIONED_MAX_AGE_MS = 6 * 60 * 60_000;

const entries = new Map<string, Entry>();
let scopeProvider: CacheScopeProvider | null = null;
let versionedMaxAgeMs = DEFAULT_VERSIONED_MAX_AGE_MS;

/** Install (or, with null, remove) the version scope. Called once at startup; also the test hook. */
export function setCacheScope(
  provider: CacheScopeProvider | null,
  maxAgeMs: number = DEFAULT_VERSIONED_MAX_AGE_MS,
): void {
  scopeProvider = provider;
  versionedMaxAgeMs = maxAgeMs;
}

function currentScope(): string | null {
  if (!scopeProvider) return null;
  try {
    return scopeProvider();
  } catch {
    return null; // a broken provider is "no version", never an error on the request path
  }
}

function isFresh(hit: Entry, scope: string | null, ttlMs: number, now: number): boolean {
  if (scope === null) return now - hit.at < ttlMs;
  return hit.scope === scope && now - hit.at < versionedMaxAgeMs;
}

export interface CachedOptions<T> {
  /** Called with a loaded value; false = serve it to the callers waiting on it but do not keep it. For a
   *  loader that swallows a storage error and returns a degraded answer: under a version scope that
   *  answer would otherwise be held for hours. */
  cacheable?: (value: T) => boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  opts: CachedOptions<T> = {},
): Promise<T> {
  const now = Date.now();
  const scope = currentScope();
  const hit = entries.get(key);
  if (hit && isFresh(hit, scope, ttlMs, now)) return hit.promise as Promise<T>;

  const forget = (): void => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  };
  const promise = load().then(
    (value) => {
      if (opts.cacheable && !opts.cacheable(value)) forget();
      return value;
    },
    (err) => {
      // Don't cache failures — let the next poll retry immediately.
      forget();
      throw err;
    },
  );
  entries.set(key, { at: now, promise, scope });
  return promise;
}

/** Drop every entry — for state the data version cannot see (targets, snapshots) and for tests. */
export function clearCache(): void {
  entries.clear();
}
