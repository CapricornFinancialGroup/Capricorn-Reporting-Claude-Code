import { describe, expect, it } from "vitest";
import {
  appendObservation,
  emptySnapshot,
  figuresEqual,
  needsExplaining,
  revisionOf,
  settleThrough,
  type WeekFigures,
  type WeekObservation,
} from "./history.js";

function figures(over: Partial<WeekFigures> = {}): WeekFigures {
  return {
    mortgageCommission: 100_000,
    mortgageCases: 50,
    protectionCommission: 20_000,
    protectionCases: 10,
    clientFees: 5_000,
    ...over,
  };
}

function observation(at: string, over: Partial<WeekFigures> = {}): WeekObservation {
  const f = figures(over);
  return { observedAt: at, lakeLoadedAt: null, group: f, byOrg: { "411": figures(), "486": f } };
}

/** Sat 25 Jul 2026 → Fri 31 Jul 2026, the week the whole reconciliation argument was about. */
const WEEK = "2026-07-25";

describe("settleThrough", () => {
  it("gives the week's end plus the input-lag window", () => {
    expect(settleThrough("2026-07-31")).toBe("2026-08-14");
  });
});

describe("figuresEqual", () => {
  it("ignores sub-penny float noise from SUM()", () => {
    expect(figuresEqual(figures(), figures({ mortgageCommission: 100_000.001 }))).toBe(true);
  });

  it("catches a penny", () => {
    expect(figuresEqual(figures(), figures({ mortgageCommission: 100_000.01 }))).toBe(false);
  });
});

describe("appendObservation", () => {
  it("records the first observation", () => {
    const s = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z"));
    expect(s.observations).toHaveLength(1);
    expect(s.weekEnd).toBe("2026-07-31");
  });

  it("does NOT record an unchanged re-observation — the history is changes, not a heartbeat", () => {
    const first = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z"));
    const second = appendObservation(first, observation("2026-08-04T09:30:00Z"));
    expect(second).toBe(first);
    expect(second.observations).toHaveLength(1);
  });

  it("records a change", () => {
    const first = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z"));
    const second = appendObservation(first, observation("2026-08-10T09:00:00Z", { protectionCommission: 15_000 }));
    expect(second.observations).toHaveLength(2);
  });

  it("notices a change confined to ONE entity even when the group total is unchanged", () => {
    // Business moving between entities nets to zero at group level. Capricorn's own report runs
    // inside one entity, so this is precisely a difference they would see and we would not.
    const base = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z"));
    const moved: WeekObservation = {
      observedAt: "2026-08-10T09:00:00Z",
      lakeLoadedAt: null,
      group: figures(),
      byOrg: { "411": figures({ mortgageCommission: 1 }), "486": figures() },
    };
    expect(appendObservation(base, moved).observations).toHaveLength(2);
  });

  it("keeps the BASELINE when trimming — it is what every comparison is made against", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T00:00:00Z", { mortgageCases: 1 }));
    for (let i = 2; i <= 20; i++) {
      s = appendObservation(s, observation(`2026-08-${String(i).padStart(2, "0")}T00:00:00Z`, { mortgageCases: i }), 5);
    }
    expect(s.observations).toHaveLength(5);
    expect(s.observations[0].group.mortgageCases).toBe(1);
    expect(s.observations[s.observations.length - 1].group.mortgageCases).toBe(20);
  });
});

describe("revisionOf", () => {
  it("is null before anything has been observed", () => {
    expect(revisionOf(emptySnapshot(WEEK))).toBeNull();
  });

  it("reports 'none' for a week that has held still", () => {
    const s = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z"));
    expect(revisionOf(s)?.severity).toBe("none");
  });

  it("reports 'settling' when a week climbs INSIDE the input-lag window", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    s = appendObservation(s, observation("2026-08-06T09:00:00Z", { mortgageCommission: 120_000 }));
    const r = revisionOf(s);
    expect(r?.severity).toBe("settling");
    expect(r?.deltas.mortgageCommission).toBe(20_000);
  });

  it("reports 'revised' when a week climbs AFTER the settle window closed", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    // Settle window ends 2026-08-14.
    s = appendObservation(s, observation("2026-08-20T09:00:00Z", { mortgageCommission: 120_000 }));
    expect(revisionOf(s)?.severity).toBe("revised");
  });

  it("reports 'reduced' when business LEAVES a closed week, even inside the settle window", () => {
    // The real case: Sat 25-31 Jul protection read £68,951 / 30 cases on 4 Aug and £64,341.82 / 28
    // on 10 Aug. Both dates are inside the settle window, so a naive "provisional" flag says this is
    // fine. It is not fine — business does not un-happen.
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-04T09:00:00Z", {
      protectionCommission: 68_951,
      protectionCases: 30,
    }));
    s = appendObservation(s, observation("2026-08-10T09:00:00Z", {
      protectionCommission: 64_341.82,
      protectionCases: 28,
    }));
    const r = revisionOf(s);
    expect(r?.severity).toBe("reduced");
    expect(r?.deltas.protectionCommission).toBeCloseTo(-4_609.18, 2);
    expect(r?.deltas.protectionCases).toBe(-2);
    expect(r?.changes).toBe(1);
  });

  it("treats a fall as 'reduced' even when another figure rose to mask it", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    s = appendObservation(s, observation("2026-08-06T09:00:00Z", {
      protectionCommission: 15_000, // down 5k
      mortgageCommission: 200_000, // up 100k — combined written still climbs
    }));
    expect(revisionOf(s)?.severity).toBe("reduced");
  });
});

describe("needsExplaining", () => {
  it("stays quiet for a steady or still-settling week", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    expect(needsExplaining(revisionOf(s))).toBe(false);
    s = appendObservation(s, observation("2026-08-06T09:00:00Z", { mortgageCommission: 120_000 }));
    expect(needsExplaining(revisionOf(s))).toBe(false);
  });

  it("flags a reduction", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    s = appendObservation(s, observation("2026-08-06T09:00:00Z", { protectionCases: 9 }));
    expect(needsExplaining(revisionOf(s))).toBe(true);
  });

  it("flags a late revision", () => {
    let s = appendObservation(emptySnapshot(WEEK), observation("2026-08-01T09:00:00Z"));
    s = appendObservation(s, observation("2026-09-01T09:00:00Z", { mortgageCases: 51 }));
    expect(needsExplaining(revisionOf(s))).toBe(true);
  });
});
