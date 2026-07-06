// Tiny in-memory TTL cache for dataset payloads.
//
// N wall TVs polling at 60s would otherwise each fan out the same Fabric queries; with a ~45s TTL
// the whole office costs ~1 query set per dataset per minute. In-flight de-dup included: concurrent
// requests for the same key await one promise. Failures are NOT cached.

interface Entry {
  at: number;
  promise: Promise<unknown>;
}

const entries = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;

  const promise = load().catch((err) => {
    // Don't cache failures — let the next poll retry immediately.
    if (entries.get(key)?.promise === promise) entries.delete(key);
    throw err;
  });
  entries.set(key, { at: now, promise });
  return promise;
}

/** Test hook. */
export function clearCache(): void {
  entries.clear();
}
