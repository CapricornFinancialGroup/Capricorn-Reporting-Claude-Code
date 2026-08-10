// End-to-end test of the observe → append → persist → classify cycle, against an in-memory blob
// layer and a stubbed lake. This is the path that has to work unattended for weeks, and it is
// exactly the path nobody was watching when Sat 25-31 Jul lost £4,609 of protection commission.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeekSnapshot } from "./history.js";

/** In-memory stand-in for blob storage, with the ETag semantics the real one has. */
const store = new Map<string, { body: WeekSnapshot; etag: string }>();
let etagSeq = 0;
/** Set to force writeSnapshot to lose one race, exercising the retry path. */
let failNextWrite = false;

vi.mock("./blob.js", () => ({
  describeError: (e: unknown) => String(e),
  readSnapshot: vi.fn(async (_account: string, weekStart: string) => {
    const hit = store.get(weekStart);
    // A brand-new week deliberately carries a BLANK weekEnd here: revisionOf must derive it from
    // weekStart rather than trust what storage hands back. An earlier version threw on this.
    return hit
      ? { snapshot: structuredClone(hit.body), etag: hit.etag }
      : { snapshot: { weekStart, weekEnd: "", observations: [] } as unknown as WeekSnapshot, etag: null };
  }),
  writeSnapshot: vi.fn(async (_account: string, snapshot: WeekSnapshot, etag: string | null) => {
    if (failNextWrite) {
      failNextWrite = false;
      return false; // simulate another instance winning the race
    }
    const current = store.get(snapshot.weekStart);
    if ((current?.etag ?? null) !== etag) return false;
    store.set(snapshot.weekStart, { body: structuredClone(snapshot), etag: `e${++etagSeq}` });
    return true;
  }),
}));

/** Stubbed lake. `rows` is swapped between passes to simulate the data changing underneath us. */
const lake = { mortgage: [] as unknown[], protection: [] as unknown[] };
vi.mock("../reporting/query.js", () => ({
  run: vi.fn(async (_pool: unknown, q: { text: string }) =>
    q.text.includes("protectioncase") ? lake.protection : lake.mortgage,
  ),
}));

import type { Config } from "../../config.js";
import { loadRevisions, recordClosedWeeks } from "./recorder.js";
import { readSnapshot } from "./blob.js";

const config = {
  fabric: { endpoint: "x", database: "y" },
  snapshots: { storageAccount: "acct", intervalMinutes: 30 },
} as unknown as Config;

/** Wed 29 Jul 2026 sits in the Sat 25 Jul week. */
const IN_WEEK = "2026-07-29";
const WEEK = "2026-07-25";
const TODAY = "2026-08-10";

function mortgageRow(commission: number, cases: number, orgKey = 486) {
  return { d: IN_WEEK, orgKey, commission, clientFees: 1000, cases };
}
function protectionRow(commission: number, cases: number, orgKey = 486) {
  return { d: IN_WEEK, orgKey, commission, cases };
}

describe("recordClosedWeeks", () => {
  beforeEach(() => {
    store.clear();
    etagSeq = 0;
    failNextWrite = false;
    lake.mortgage = [mortgageRow(413_540.51, 222)];
    lake.protection = [protectionRow(68_951, 30)];
  });

  it("skips cleanly when no storage account is configured — never breaks the board", async () => {
    const out = await recordClosedWeeks({ ...config, snapshots: { storageAccount: "", intervalMinutes: 30 } } as Config, TODAY, null, "2026-08-04T09:00:00Z");
    expect(out).toEqual({ observed: 0, changed: [], skipped: true });
    expect(store.size).toBe(0);
  });

  it("records a baseline on the first pass", async () => {
    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");
    expect(out.changed).toContain(WEEK);
    const saved = (await readSnapshot("acct", WEEK)).snapshot;
    expect(saved.observations).toHaveLength(1);
    expect(saved.observations[0].group.protectionCommission).toBe(68_951);
    expect(saved.observations[0].group.protectionCases).toBe(30);
  });

  it("writes NOTHING on a second pass over unchanged data", async () => {
    await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");
    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:30:00Z");
    expect(out.changed).toEqual([]);
    expect((await readSnapshot("acct", WEEK)).snapshot.observations).toHaveLength(1);
  });

  it("catches business LEAVING a closed week — the July failure, reproduced", async () => {
    await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");

    // Six days later, two protection cases have gone. Nothing else changed; no code changed.
    lake.protection = [protectionRow(64_341.82, 28)];
    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-10T09:00:00Z");
    expect(out.changed).toContain(WEEK);

    const [revision] = await loadRevisions(config, [WEEK]);
    expect(revision.severity).toBe("reduced");
    expect(revision.deltas.protectionCommission).toBeCloseTo(-4_609.18, 2);
    expect(revision.deltas.protectionCases).toBe(-2);
    expect(revision.changes).toBe(1);
  });

  it("retries after losing a write race, and still lands the observation", async () => {
    await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");
    lake.protection = [protectionRow(64_341.82, 28)];
    failNextWrite = true;

    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-10T09:00:00Z");
    expect(out.changed).toContain(WEEK);
    expect((await readSnapshot("acct", WEEK)).snapshot.observations).toHaveLength(2);
  });

  it("splits by entity, so a group total that hides an entity-level move is still caught", async () => {
    lake.mortgage = [mortgageRow(200_000, 100, 486), mortgageRow(100_000, 50, 411)];
    await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");
    const first = (await readSnapshot("acct", WEEK)).snapshot.observations[0];
    expect(first.group.mortgageCommission).toBe(300_000);
    expect(first.byOrg["486"].mortgageCommission).toBe(200_000);
    expect(first.byOrg["411"].mortgageCommission).toBe(100_000);

    // Same group total, business moved between entities. Capricorn's own report runs inside one
    // entity, so this is a difference they would see and a group-only check would not.
    lake.mortgage = [mortgageRow(250_000, 100, 486), mortgageRow(50_000, 50, 411)];
    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-10T09:00:00Z");
    expect(out.changed).toContain(WEEK);
  });

  it("survives a storage failure on one week without abandoning the rest", async () => {
    const blob = await import("./blob.js");
    const spy = vi.mocked(blob.readSnapshot);
    spy.mockRejectedValueOnce(new Error("boom"));
    const out = await recordClosedWeeks(config, TODAY, null, "2026-08-04T09:00:00Z");
    expect(out.skipped).toBe(false);
    expect(out.observed).toBe(13);
    // The failing week is missing, but the pass completed and recorded the week that has data.
    expect(store.has(WEEK)).toBe(true);
  });
});
