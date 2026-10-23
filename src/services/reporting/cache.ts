// In-memory cache for dataset payloads, keyed on the Gold DATA VERSION (PBI 93610) with a wall-clock
// TTL as the fallback.
//
// Why a version and not just a TTL. Every payload the board serves is a pure function of the Capricorn
// copy of Gold, the London date, the active targets and the week-snapshot blob. Gold changes four times
// a day. A 45 s TTL against a wall that changes page every 20 s therefore re-queried Fabric on nearly
// every page change for data that had not moved — ~113k statements a day per screen, and the SQL
// endpoint held allocated around the clock (~87 CU-h/day against a target of 11).
//
// How it works. A scope provider (share-version.ts) says "the data is at version V on London date D".
//   - Scope known: an entry is a hit while its scope still equals the current one. It does not matter
//     how old it is; only a new version, a new date, or the safety cap (`versionedMaxAgeMs`, which
//     bounds anything the version cannot see) makes the next request reload it.
//   - Scope unknown (never probed, probe failing past its trust window, provider throws): the per-call
//     `ttlMs` applies exactly as it did before this change. The board never errors for want of a
//     version and never serves something older than it used to.
// In-flight de-duplication is unchanged: concurrent requests for a key await one promise. Failures are
// NOT cached.
//
// The two things the scope cannot see, which therefore call `clearCache()` when they change: the active
// targets (targets/store.ts `activateTargets`) and the week-snapshot blob (snapshots/scheduler.ts).

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

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const scope = currentScope();
  const hit = entries.get(key);
  if (hit && isFresh(hit, scope, ttlMs, now)) return hit.promise as Promise<T>;

  const promise = load().catch((err) => {
    // Don't cache failures — let the next poll retry immediately.
    if (entries.get(key)?.promise === promise) entries.delete(key);
    throw err;
  });
  entries.set(key, { at: now, promise, scope });
  return promise;
}

/** Drop every entry — for state the data version cannot see (targets, snapshots) and for tests. */
export function clearCache(): void {
  entries.clear();
}
