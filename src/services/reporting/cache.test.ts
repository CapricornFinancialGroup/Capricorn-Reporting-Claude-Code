// PBI 93610 — the dataset cache is keyed on (Gold data version, London date) when a version is known,
// and falls back to the call site's own wall-clock TTL when it is not.
//
// The two properties that matter:
//   1. With a version, an entry outlives its 45 s TTL and is only reloaded when the version or the
//      date moves (or the safety cap is hit) — that is what stops every wall page change re-querying
//      Fabric for data that changes four times a day.
//   2. Without a version (never probed, probe failing, provider throwing) the cache behaves exactly
//      as it did before this change — never an error, never a stuck entry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearCache, setCacheScope } from "./cache.js";

const MIN = 60_000;

function counter() {
  let loads = 0;
  return {
    get loads() {
      return loads;
    },
    load: async () => ++loads,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T09:00:00Z"));
  clearCache();
  setCacheScope(null);
});

afterEach(() => {
  setCacheScope(null);
  vi.useRealTimers();
});

describe("time-based fallback (no scope) — today's behaviour, unchanged", () => {
  it("serves a hit inside the TTL and reloads after it", async () => {
    const c = counter();
    await cached("k", 45_000, c.load);
    vi.advanceTimersByTime(44_000);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(1);
    vi.advanceTimersByTime(2_000);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2);
  });

  it("de-duplicates concurrent loads and does not cache a failure", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(cached("f", 45_000, failing)).rejects.toThrow("boom");
    await expect(cached("f", 45_000, failing)).rejects.toThrow("boom");
    expect(calls).toBe(2);

    const c = counter();
    await Promise.all([cached("d", 45_000, c.load), cached("d", 45_000, c.load)]);
    expect(c.loads).toBe(1);
  });
});

describe("keyed on the data version", () => {
  it("keeps an entry far beyond its wall-clock TTL while the scope is unchanged", async () => {
    setCacheScope(() => "v1|2026-10-23");
    const c = counter();
    await cached("k", 45_000, c.load);
    vi.advanceTimersByTime(20 * MIN); // 26 wall-TTLs later
    await cached("k", 45_000, c.load);
    await cached("k", 60_000, c.load);
    expect(c.loads).toBe(1);
  });

  it("reloads when the data version moves", async () => {
    let scope = "v1|2026-10-23";
    setCacheScope(() => scope);
    const c = counter();
    await cached("k", 45_000, c.load);
    scope = "v2|2026-10-23";
    await cached("k", 45_000, c.load);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2); // one reload for v2, then v2 is served from cache
  });

  it("reloads when the London date moves, even if the version has not", async () => {
    let scope = "v1|2026-10-23";
    setCacheScope(() => scope);
    const c = counter();
    await cached("k", 45_000, c.load);
    scope = "v1|2026-10-24";
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2);
  });

  it("still reloads at the safety cap, so a signal the version cannot see is bounded", async () => {
    setCacheScope(() => "v1|2026-10-23", 6 * 60 * MIN);
    const c = counter();
    await cached("k", 45_000, c.load);
    vi.advanceTimersByTime(5 * 60 * MIN);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(1);
    vi.advanceTimersByTime(61 * MIN);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2);
  });

  it("does not serve an entry loaded under no version as if it belonged to a version", async () => {
    const c = counter();
    await cached("k", 45_000, c.load); // loaded time-based, scope unknown
    setCacheScope(() => "v1|2026-10-23");
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2);
  });
});

describe("falls back to wall-clock TTL when the version is not usable", () => {
  it("scope provider returning null goes back to the per-call TTL", async () => {
    let scope: string | null = "v1|2026-10-23";
    setCacheScope(() => scope);
    const c = counter();
    await cached("k", 45_000, c.load);
    scope = null; // the version probe has been failing long enough to lose trust
    vi.advanceTimersByTime(30_000);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(1); // inside the TTL: still a hit
    vi.advanceTimersByTime(20_000);
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2); // past it: reloads, exactly like before this change
  });

  it("scope provider throwing is treated as no version, not as an error", async () => {
    setCacheScope(() => {
      throw new Error("provider broke");
    });
    const c = counter();
    await expect(cached("k", 45_000, c.load)).resolves.toBe(1);
    await expect(cached("k", 45_000, c.load)).resolves.toBe(1);
    expect(c.loads).toBe(1);
  });
});

describe("clearCache", () => {
  it("drops versioned entries too (used when targets or snapshots change underneath the payloads)", async () => {
    setCacheScope(() => "v1|2026-10-23");
    const c = counter();
    await cached("k", 45_000, c.load);
    clearCache();
    await cached("k", 45_000, c.load);
    expect(c.loads).toBe(2);
  });
});
