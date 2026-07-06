import { describe, expect, it } from "vitest";
import { mtdPacing } from "./pacing.js";

describe("mtdPacing", () => {
  it("anchors the chase month on the data-as-of day", () => {
    const ctx = mtdPacing("2026-07-05");
    expect(ctx.monthStart).toBe("2026-07-01");
    expect(ctx.monthEnd).toBe("2026-07-31");
    expect(ctx.workingDaysElapsed).toBe(3);
    expect(ctx.workingDaysTotal).toBe(23);
    expect(ctx.fraction).toBeCloseTo(3 / 23);
    expect(ctx.nowLabel).toBe("Jul 5");
  });

  it("caps the fraction at 1 on the final day", () => {
    expect(mtdPacing("2026-07-31").fraction).toBe(1);
  });
});
