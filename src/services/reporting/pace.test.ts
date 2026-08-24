import { describe, expect, it } from "vitest";
import { chaseStatus, computePace, paceInclPartDay, paceStatus } from "./pace.js";

describe("paceInclPartDay — the card's one verdict, and it has to add up", () => {
  // The real board, Mon 24 Aug 2026 at the 14:42 load. Leads: weekly 633, Sat+Sun delivered 44
  // against 47 expected, today 62 against a Monday target of 122 with a third of the day recorded.
  const leads = () => paceInclPartDay(633, 44, 47, 62, 122, 1 / 3);

  it("reconciles with the complete-day verdict plus today's own", () => {
    // This identity is the whole point. Before it, the card showed "Behind −3" in the header and
    // "+49 ahead" on the tile, and no reader could make those two facts describe one week.
    const completeGap = 44 - 47; // −3
    const todayGap = 62 - Math.round(122 * (1 / 3)); // 62 − 41 = +21
    expect(leads().aheadBehind).toBe(completeGap + todayGap); // +18
  });

  it("counts today's business, so a strong day is visible before it closes", () => {
    expect(leads().current).toBe(106); // 44 complete + 62 today
    expect(leads().expectedByNow).toBe(88); // 47 + 122/3
    expect(leads().status).toBe("ahead");
  });

  it("judges today against the recorded share, NOT the whole day's target", () => {
    // Against Monday's full 122 the same figures read 106 vs 169 — behind by 63, and "behind" every
    // morning of every week regardless of performance. That is the 2026-07-30 collapse.
    expect(leads().expectedByNow).toBeLessThan(47 + 122);
    expect(paceInclPartDay(633, 44, 47, 62, 122, 1).aheadBehind).toBe(-63);
  });

  it("uses TODAY's target — the judged day's would flatter a Monday", () => {
    // Saturday's leads target is 38 against Monday's 122. Substituting it — which is exactly what
    // the tile did, reading `day.target` — inflates the week verdict from +18 to +46. At DAY scope,
    // where the bug was visible on screen, the same substitution turned 62-vs-41 (+21) into
    // 62-vs-13 (+49).
    expect(paceInclPartDay(633, 44, 47, 62, 38, 1 / 3).aheadBehind).toBe(46);
    expect(leads().aheadBehind).toBe(18);
    // The day-scope arithmetic the tile now does, both ways round.
    expect(62 - Math.round(122 * (1 / 3))).toBe(21);
    expect(62 - Math.round(38 * (1 / 3))).toBe(49);
  });

  it("at the first load of the day, reads as the complete days alone", () => {
    // recordedShare ~1.5% at the ~06:00 load: today has essentially nothing in, so the verdict must
    // not swing on it. 44 + 0 against 47 + 1.8.
    const dawn = paceInclPartDay(633, 44, 47, 0, 122, 0.015);
    expect(dawn.current).toBe(44);
    expect(dawn.aheadBehind).toBe(-5);
  });

  it("survives an untargeted KPI without inventing a verdict", () => {
    const none = paceInclPartDay(0, 0, 0, 3, 0, 1 / 3);
    expect(none.expectedByNow).toBe(0);
    expect(none.target).toBe(0);
  });
});

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
