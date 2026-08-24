import { describe, expect, it } from "vitest";
import { chaseStatus, computePace, paceStatus } from "./pace.js";

describe("computePace", () => {
  it("reads ahead when current exceeds expected", () => {
    const p = computePace(100, 60, 0.5);
    expect(p.expectedByNow).toBe(50);
    expect(p.aheadBehind).toBe(10);
    expect(p.projectedFinish).toBe(120);
    expect(p.status).toBe("ahead");
  });

  it("falls back to the target before the period opens", () => {
    const p = computePace(100, 0, 0);
    expect(p.projectedFinish).toBe(100);
    expect(p.status).toBe("on_pace");
  });

  it("reads behind under 95% of expected", () => {
    expect(computePace(100, 40, 0.5).status).toBe("behind");
  });
});

describe("status banding", () => {
  it("paceStatus is on_pace within ±5%", () => {
    expect(paceStatus(100, 100)).toBe("on_pace");
    expect(paceStatus(104, 100)).toBe("on_pace");
    expect(paceStatus(106, 100)).toBe("ahead");
    expect(paceStatus(94, 100)).toBe("behind");
  });

  it("chaseStatus adds the critical tier under 60%", () => {
    expect(chaseStatus(100, 100)).toBe("ahead");
    expect(chaseStatus(92, 100)).toBe("on_pace");
    expect(chaseStatus(70, 100)).toBe("behind");
    expect(chaseStatus(50, 100)).toBe("critical");
  });

  it("zero expected treats any progress as ahead", () => {
    expect(chaseStatus(1, 0)).toBe("ahead");
    expect(chaseStatus(0, 0)).toBe("on_pace");
  });

  // 2026-08-24: a Saturday with 0 protection referrals against a target of 1 was flagged CRITICAL,
  // beside leads and mortgages both +6 ahead. At an expectation of 1 the bands are not a scale — the
  // only reachable outcomes are critical and ahead — so one case decided between the board's loudest
  // word and its best one.
  it("will not shout CRITICAL when a single case decides the verdict", () => {
    expect(chaseStatus(0, 1)).toBe("behind");
    expect(chaseStatus(0, 1.9)).toBe("behind");
    // Still reports the direction — it is behind, and the figures are printed beside it.
    expect(chaseStatus(1, 1)).toBe("ahead");
  });

  it("keeps CRITICAL once the shortfall is two whole cases or more", () => {
    expect(chaseStatus(0, 2)).toBe("critical"); // two short
    expect(chaseStatus(1, 3)).toBe("critical"); // two short
    expect(chaseStatus(0, 9)).toBe("critical"); // the Sunday leads case, had it still been judged
    expect(chaseStatus(20, 100)).toBe("critical");
  });

  it("holds at behind while the shortfall is under two cases, however bad the ratio", () => {
    expect(chaseStatus(1, 2)).toBe("behind"); // 50%, one case short
    expect(chaseStatus(1, 2.5)).toBe("behind"); // 40%, one and a half short
    expect(chaseStatus(0, 1.9)).toBe("behind");
  });
});
