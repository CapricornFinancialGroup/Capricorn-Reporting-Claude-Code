import { describe, expect, it } from "vitest";
import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import { mortgageWrittenByOrgDaily, protectionWrittenByOrgDaily } from "./reconciliation.js";
import { protectionWrittenDaily, revenueDaily } from "./momentum.js";
import { closedWeekStarts } from "../snapshots/recorder.js";

describe("reconciliation queries", () => {
  it("carries OrganisationKey through instead of summing it away", () => {
    for (const q of [mortgageWrittenByOrgDaily("2026-07-25", "2026-07-31"), protectionWrittenByOrgDaily("2026-07-25", "2026-07-31")]) {
      expect(q.text).toContain("f.OrganisationKey AS orgKey");
      expect(q.text).toContain("GROUP BY");
      expect(q.text).toMatch(/GROUP BY[^;]*f\.OrganisationKey/);
    }
  });

  it("uses the SAME basis as the board's own written figures", () => {
    // If these ever diverge, the reconciliation screen explains a number the board doesn't show.
    const mortgage = mortgageWrittenByOrgDaily("2026-07-25", "2026-07-31");
    expect(mortgage.text).toContain(MORTGAGE_WRITTEN_DATE);
    expect(mortgage.text).toContain("SUM(COALESCE(f.ProductCommission, 0)) AS commission");
    expect(revenueDaily("2026-07-25", "2026-07-31").text).toContain(MORTGAGE_WRITTEN_DATE);

    const protection = protectionWrittenByOrgDaily("2026-07-25", "2026-07-31");
    expect(protection.text).toContain(PROTECTION_WRITTEN_DATE);
    expect(protection.text).toContain("SUM(COALESCE(f.ProductCommission, 0)) AS commission");
    for (const s of PROTECTION_WRITTEN_STATUSES) expect(protection.text).toContain(`'${s}'`);
    expect(protectionWrittenDaily("2026-07-25", "2026-07-31").text).toContain(PROTECTION_WRITTEN_DATE);
  });

  it("never gates protection on a WorkflowStatus date column", () => {
    // The £402,590 error: those DATE columns are populated on a quarter of cases; the STATUS is not.
    expect(protectionWrittenByOrgDaily("2026-07-25", "2026-07-31").text).not.toContain("WorkflowStatusSubmittedtoUnderwriters");
  });

  it("excludes deleted cases on both legs", () => {
    expect(mortgageWrittenByOrgDaily("2026-07-25", "2026-07-31").text).toContain("DeletedYN");
    expect(protectionWrittenByOrgDaily("2026-07-25", "2026-07-31").text).toContain("DeletedYN");
  });
});

describe("closedWeekStarts", () => {
  it("returns Saturdays, oldest first", () => {
    const weeks = closedWeekStarts("2026-08-10", 4); // a Monday
    expect(weeks).toEqual(["2026-07-11", "2026-07-18", "2026-07-25", "2026-08-01"]);
    for (const w of weeks) expect(new Date(`${w}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("EXCLUDES the current week — a week still running is supposed to be moving", () => {
    // Mon 10 Aug sits in the Sat 8 Aug week; observing it would log a 'change' every few hours.
    expect(closedWeekStarts("2026-08-10", 4)).not.toContain("2026-08-08");
  });

  it("treats Saturday itself as the start of the new, still-open week", () => {
    const weeks = closedWeekStarts("2026-08-08", 2);
    expect(weeks).not.toContain("2026-08-08");
    expect(weeks[weeks.length - 1]).toBe("2026-08-01");
  });
});
