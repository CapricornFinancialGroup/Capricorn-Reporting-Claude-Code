import { describe, expect, it } from "vitest";
import { monthlyTarget, workingDaysElapsed, workingDaysInMonth } from "./targets.js";

describe("working-day maths", () => {
  it("counts working days in July 2026 (23 weekdays)", () => {
    expect(workingDaysInMonth("2026-07-15")).toBe(23);
  });

  it("counts elapsed working days through a Sunday (Jul 5 2026 → Wed–Fri = 3)", () => {
    expect(workingDaysElapsed("2026-07-05")).toBe(3);
  });

  it("elapsed equals total on the last day of the month", () => {
    expect(workingDaysElapsed("2026-07-31")).toBe(workingDaysInMonth("2026-07-31"));
  });

  it("derives the monthly target from the daily target", () => {
    expect(monthlyTarget(10, "2026-07-15")).toBe(230);
  });
});
