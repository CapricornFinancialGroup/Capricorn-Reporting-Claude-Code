// PBI 93610 — the week-snapshot timer still ticks on its own clock (so a closed week quietly moving
// over a weekend is still caught with nobody watching), but a tick only goes to Fabric when the Gold
// data version has moved since the last observation that completed. Unknown version = observe, because
// missing a real movement is worse than one redundant read.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";

const recorder = vi.hoisted(() => ({
  calls: 0,
  fail: false,
  changed: [] as string[],
  failed: [] as string[],
}));

vi.mock("./recorder.js", () => ({
  recordClosedWeeks: vi.fn(async () => {
    recorder.calls++;
    if (recorder.fail) throw new Error("lake unreachable");
    return { skipped: false, changed: recorder.changed, failed: recorder.failed, observed: 13 };
  }),
}));

vi.mock("../reporting/datasets.js", () => ({
  lastRefreshAt: vi.fn(async () => "2026-10-23T05:44:00.000Z"),
}));

import { cached, clearCache } from "../reporting/cache.js";
import { startSnapshotScheduler } from "./scheduler.js";

const config = {
  reporting: { timeZone: "Europe/London" },
  snapshots: { storageAccount: "acct", intervalMinutes: 30 },
} as unknown as Config;

function versionSource(initial: string | null) {
  let v = initial;
  return { trustedVersion: () => v, set: (next: string | null) => (v = next) };
}

beforeEach(() => {
  recorder.calls = 0;
  recorder.fail = false;
  recorder.changed = [];
  recorder.failed = [];
  clearCache();
});

afterEach(() => vi.useRealTimers());

describe("startSnapshotScheduler — gated on the Gold data version", () => {
  it("observes on every tick while the version is unknown (fails open)", async () => {
    const s = startSnapshotScheduler(config, versionSource(null));
    await s.runOnce();
    await s.runOnce();
    expect(recorder.calls).toBe(2);
    s.stop();
  });

  it("observes once, then skips while the version stays the same", async () => {
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    await s.runOnce();
    await s.runOnce();
    await s.runOnce();
    expect(recorder.calls).toBe(1);
    s.stop();
  });

  it("observes again when the version moves", async () => {
    const v = versionSource("aaaa");
    const s = startSnapshotScheduler(config, v);
    await s.runOnce();
    await s.runOnce(); // unchanged: skipped
    v.set("bbbb");
    await s.runOnce();
    await s.runOnce(); // unchanged again: skipped
    expect(recorder.calls).toBe(2);
    s.stop();
  });

  it("after a gap of unknown version it observes once more, then skips again", async () => {
    // The observation made while the version was unknown cannot be attributed to any version, so the
    // first tick back on a known one re-reads rather than assume. Conservative by design.
    const v = versionSource("aaaa");
    const s = startSnapshotScheduler(config, v);
    await s.runOnce(); // 1
    v.set(null);
    await s.runOnce(); // 2: unknown, observes
    v.set("aaaa");
    await s.runOnce(); // 3: known again, not yet attributed to it
    await s.runOnce(); // skipped
    expect(recorder.calls).toBe(3);
    s.stop();
  });

  it("a failed pass does not count as an observation, so the next tick retries the same version", async () => {
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    recorder.fail = true;
    await s.runOnce(); // swallowed, logged
    recorder.fail = false;
    await s.runOnce();
    await s.runOnce();
    expect(recorder.calls).toBe(2); // the failed one, the retry — then skipped
    s.stop();
  });

  it("a pass that could not persist a week does not count as an observation either (the tick retries)", async () => {
    // recordClosedWeeks logs and swallows a per-week blob failure, so the pass 'completes'.
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    recorder.failed = ["2026-09-12"];
    await s.runOnce();
    await s.runOnce();
    recorder.failed = [];
    await s.runOnce();
    await s.runOnce();
    expect(recorder.calls).toBe(3); // two attempts that failed to persist, one that did, then skipped
    s.stop();
  });

  it("observes again when the London date rolls over, even if the version has not moved", async () => {
    // A new closed week joins the set at Saturday midnight; its baseline must not wait for the next load.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T20:00:00Z")); // Fri 21:00 London
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    await s.runOnce();
    await s.runOnce(); // same version, same day: skipped
    vi.setSystemTime(new Date("2026-10-23T23:30:00Z")); // Sat 00:30 London
    await s.runOnce();
    await s.runOnce(); // skipped again
    expect(recorder.calls).toBe(2);
    s.stop();
  });

  it("observes again across the Sunday-to-Monday London midnight with the version unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T22:00:00Z")); // Sun 22:00 London (GMT since 25 Oct)
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    await s.runOnce();
    vi.setSystemTime(new Date("2026-10-25T23:30:00Z")); // still Sun in London? GMT: 23:30 Sun
    await s.runOnce(); // same date: skipped
    vi.setSystemTime(new Date("2026-10-26T00:30:00Z")); // Mon 00:30 London
    await s.runOnce();
    expect(recorder.calls).toBe(2);
    s.stop();
  });

  it("drops cached payloads when a closed week has moved (the revised-weeks warning reads that blob)", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cached("revised-week-count", 5 * 60_000, load);
    recorder.changed = ["2026-09-12"];
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    await s.runOnce();
    await cached("revised-week-count", 5 * 60_000, load);
    expect(loads).toBe(2);
    s.stop();
  });

  it("leaves cached payloads alone when nothing moved", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cached("revised-week-count", 5 * 60_000, load);
    const s = startSnapshotScheduler(config, versionSource("aaaa"));
    await s.runOnce();
    await cached("revised-week-count", 5 * 60_000, load);
    expect(loads).toBe(1);
    s.stop();
  });
});
