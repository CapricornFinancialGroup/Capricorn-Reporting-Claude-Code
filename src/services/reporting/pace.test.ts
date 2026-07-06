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
});
