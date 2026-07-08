import { describe, expect, it } from "vitest";
import { daysBetween, monthOf, pctDelta, previousPeriod, shiftDays, weekdaysBetween, weekStartOf } from "./trends.js";

describe("pctDelta", () => {
  it("computes the fractional change, null on zero base", () => {
    expect(pctDelta(120, 100)).toBeCloseTo(0.2);
    expect(pctDelta(80, 100)).toBeCloseTo(-0.2);
    expect(pctDelta(5, 0)).toBeNull();
  });
});

describe("shiftDays", () => {
  it("shifts across month boundaries", () => {
    expect(shiftDays("2026-06-01", -1)).toBe("2026-05-31");
    expect(shiftDays("2026-06-30", 1)).toBe("2026-07-01");
  });
});

describe("daysBetween", () => {
  it("counts whole days, signed", () => {
    expect(daysBetween("2026-06-15", "2026-06-18")).toBe(3);
    expect(daysBetween("2026-06-18", "2026-06-15")).toBe(-3);
    expect(daysBetween("2026-06-18", "2026-06-18")).toBe(0);
  });
});

describe("weekStartOf — Capricorn's Sat–Fri reporting week", () => {
  it("returns the Saturday starting the week containing the date", () => {
    const start = weekStartOf("2026-06-17"); // a Wednesday
    expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(6); // Saturday
    expect(start).toBe("2026-06-13");
  });

  it("a Friday belongs to the week that started the preceding Saturday", () => {
    expect(weekStartOf("2026-06-19")).toBe("2026-06-13"); // Fri → same week's Sat
  });

  it("a Saturday anchors its own week (self-start)", () => {
    expect(weekStartOf("2026-06-13")).toBe("2026-06-13");
  });

  it("a Sunday belongs to the week that started the day before", () => {
    expect(weekStartOf("2026-06-14")).toBe("2026-06-13");
  });
});

describe("monthOf", () => {
  it("returns the first and last day of the calendar month", () => {
    expect(monthOf("2026-06-17")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(monthOf("2026-02-10").to).toBe("2026-02-28");
  });
});

describe("weekdaysBetween", () => {
  it("counts Mon–Fri inclusively, excluding weekends", () => {
    // Mon 15 Jun → Fri 19 Jun 2026 = 5 weekdays.
    expect(weekdaysBetween("2026-06-15", "2026-06-19")).toBe(5);
    // Mon 15 → Sun 21 spans a full week = still 5 weekdays.
    expect(weekdaysBetween("2026-06-15", "2026-06-21")).toBe(5);
    // A weekend-only range has none.
    expect(weekdaysBetween("2026-06-20", "2026-06-21")).toBe(0); // Sat–Sun
    // Single weekday.
    expect(weekdaysBetween("2026-06-17", "2026-06-17")).toBe(1); // Wed
  });
});

describe("previousPeriod", () => {
  it("returns the equal-length window immediately before", () => {
    expect(previousPeriod({ from: "2026-06-15", to: "2026-06-21" })).toEqual({ from: "2026-06-08", to: "2026-06-14" });
    expect(previousPeriod({ from: "2026-06-17", to: "2026-06-17" })).toEqual({ from: "2026-06-16", to: "2026-06-16" });
  });
});
