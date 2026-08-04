// Pure query-builder tests: assert the SQL text carries the firm scoping, deleted-case exclusion
// and date binding conventions, and that params bind what the text references.

import { describe, expect, it } from "vitest";
import { mortgageStageCounts } from "./funnel.js";
import { kpiDaily, kpiDailyByAdviser, KPI_SPECS } from "./kpis.js";
import { protectionWrittenDaily, revenueDaily } from "./momentum.js";
import { applicationEvents, leadEvents, referralEvents, saleEvents } from "./ticker.js";
import { revenueByAdviser } from "./advisers.js";
import type { BuiltQuery } from "./query.js";

function expectConventions(q: BuiltQuery, opts: { deletedFlag?: boolean } = {}): void {
  expect(q.text).toMatch(/OrganisationKey IN \(@Org0, @Org1\)/);
  if (opts.deletedFlag !== false) expect(q.text).toMatch(/COALESCE\(f\.DeletedYN, 'N'\) <> 'Y'/);
  const bound = new Set(q.params.map((p) => p.name));
  const referenced = [...q.text.matchAll(/@(\w+)/g)].map((m) => m[1]);
  for (const name of referenced) expect(bound, `param @${name} must be bound`).toContain(name);
  expect(bound.size).toBe(q.params.length); // no duplicate param names
}

// Capricorn's Total Written Report (usp_GetTotalProductReport) keys "written" on the date a product
// entered status 70, 'Pre-offer Processing' — NOT mortgagecase.WrittenDate, which the Gold ETL builds
// as COALESCE(SubmissionDate, status-70 date) and which therefore sits days earlier. Getting this
// wrong is what made the board irreconcilable with their report (Kyle 2026-07-28), so it is pinned.
describe("mortgage 'written' keys on the platform's status-70 date", () => {
  const STATUS_70 = "WorkflowStatusPreOfferProcessingDate";

  it("uses the status-70 column, never WrittenDate, for mortgage money and counts", () => {
    for (const q of [
      kpiDaily("applications", "2026-07-01", "2026-07-31"),
      kpiDailyByAdviser("applications", "2026-07-01", "2026-07-31"),
      revenueDaily("2026-07-01", "2026-07-31"),
      revenueByAdviser("2026-07-01", "2026-07-31"),
      mortgageStageCounts("2026-07-01", "2026-07-31"),
    ]) {
      expect(q.text).toContain(STATUS_70);
      // The only WrittenDate that may appear is as the prefix of the status column name.
      expect(q.text.replace(new RegExp(STATUS_70, "g"), "")).not.toContain("WrittenDate");
    }
  });

  // Protection keys on ApplicationDate - Capricorn's own "Date Submitted" - and counts cases at or
  // beyond submission. This is what reconciles to Kyle's c.£69K for Sat 25-31 Jul (the old
  // WrittenDate basis gave £48,969). The previous note here claimed status 65 was populated on only
  // ~20% of cases; that was read off the sparse WorkflowStatus*Date column, not WorkflowStatusId,
  // which carries 65 on 220 of 248. See PROTECTION_WRITTEN_DATE.
  it("keys protection written on ApplicationDate, at or beyond submission", () => {
    expect(KPI_SPECS.sales.dateColumn).toBe("ApplicationDate");
    expect(KPI_SPECS.sales.extraClause).toContain("WorkflowStatusId");
    const q = protectionWrittenDaily("2026-07-01", "2026-07-31");
    expect(q.text).toContain("GROUP BY CAST(f.ApplicationDate AS date)");
    expect(q.text).toContain("WorkflowStatusId IN ('60', '65', '70', '105', '120')");
    expect(q.text).not.toContain(STATUS_70);
  });

  // Never infer "reached status X" from a WorkflowStatus*Date column in this feed - they are
  // unreliably populated, and doing so is what produced the wrong "£400k would disappear" warning.
  it("never gates protection on a WorkflowStatus date column", () => {
    const q = protectionWrittenDaily("2026-07-01", "2026-07-31");
    expect(q.text).not.toContain("WorkflowStatusSubmittedtoUnderwriters");
  });
});

describe("kpi builders", () => {
  it("covers all four KPIs with the verified semantics", () => {
    expect(KPI_SPECS.leads.countExpr).toContain("DISTINCT");
    expect(KPI_SPECS.applications.countExpr).toBe("COUNT(*)");
    // Protection Opportunities = protectioncase OPENED. crosssellreferral (PaymentShield quotes +
    // currency exchange) must never come back as the source — see PROTECTION_OPPORTUNITY_NOTE.
    expect(KPI_SPECS.referrals.table).toBe("dbo.protectioncase");
    expect(KPI_SPECS.referrals.dateColumn).toBe("CreatedDate");
    for (const kpi of ["leads", "applications", "referrals", "sales"] as const) {
      expect(KPI_SPECS[kpi].table).not.toContain("crosssellreferral");
    }
    expect(KPI_SPECS.sales.table).toContain("protectioncase");
  });

  it("protection opportunities count cases opened, with the deleted-case convention", () => {
    const q = kpiDaily("referrals", "2026-07-01", "2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("dbo.protectioncase");
    expect(q.text).toContain("GROUP BY CAST(f.CreatedDate AS date)");
  });

  it("kpiDaily binds the range and groups by day", () => {
    const q = kpiDaily("leads", "2026-07-01", "2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("GROUP BY CAST(f.LeadDate AS date)");
    expect(q.params.find((p) => p.name === "From")?.value).toBe("2026-07-01");
    expect(q.params.find((p) => p.name === "To")?.value).toBe("2026-07-05");
  });

  it("kpiDailyByAdviser joins useraccount", () => {
    const q = kpiDailyByAdviser("sales", "2026-07-01", "2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("dbo.useraccount");
    expect(q.text).toContain("PrimaryAdviserUserAccountKey");
  });
});

// The bulk-migration batch is mis-dated on LeadDate, so the guard belongs to LeadDate-keyed metrics
// ONLY. Applied to WrittenDate-keyed ones it deleted genuine written business — 16 cases / £19,592
// of July written commission (Kyle's 2026-07-28 reconciliation). These tests are the regression net.
describe("migration guard is scoped to LeadDate-keyed metrics", () => {
  const hasGuard = (q: BuiltQuery) => /NOT \(f\.OrganisationKey = @MigOrg0 AND f\.LeadDate = @MigDate0\)/.test(q.text);

  it("guards the leads KPI", () => {
    expect(hasGuard(kpiDaily("leads", "2026-07-01", "2026-07-31"))).toBe(true);
    expect(hasGuard(kpiDailyByAdviser("leads", "2026-07-01", "2026-07-31"))).toBe(true);
  });

  it("does NOT guard WrittenDate-keyed KPIs", () => {
    for (const kpi of ["applications", "sales"] as const) {
      expect(hasGuard(kpiDaily(kpi, "2026-07-01", "2026-07-31")), kpi).toBe(false);
      expect(hasGuard(kpiDailyByAdviser(kpi, "2026-07-01", "2026-07-31")), kpi).toBe(false);
    }
  });

  it("does NOT guard the written-money builders", () => {
    expect(hasGuard(revenueDaily("2026-07-01", "2026-07-31"))).toBe(false);
    expect(hasGuard(revenueByAdviser("2026-07-01", "2026-07-31"))).toBe(false);
    expect(hasGuard(protectionWrittenDaily("2026-07-01", "2026-07-31"))).toBe(false);
  });

  it("guards only the leads expression inside mortgageStageCounts, not the whole WHERE", () => {
    const q = mortgageStageCounts("2026-07-01", "2026-07-31");
    expect(hasGuard(q)).toBe(true);
    // The guard must sit inside the leads COUNT(DISTINCT CASE …), so applications/offers keep their
    // rows. Everything before the applications SUM is the leads expression.
    const leadsExpr = q.text.slice(0, q.text.indexOf("AS leads"));
    expect(hasGuard({ text: leadsExpr, params: [] })).toBe(true);
    expect(q.text.slice(q.text.indexOf("AS leads"))).not.toContain("@MigOrg0");
  });
});

describe("funnel builders", () => {
  it("mortgageStageCounts counts leads, applications and offers in one pass", () => {
    const q = mortgageStageCounts("2026-07-01", "2026-07-05");
    expectConventions(q);
    // Both "written" and "offers" use the platform's own status-date columns. OfferIssueDate is 97%
    // empty and must never come back as the offers source (it showed 66 July offers against 526).
    for (const col of ["LeadDate", "WorkflowStatusPreOfferProcessingDate", "WorkflowStatusPostOfferProcessingDate"]) {
      expect(q.text).toContain(col);
    }
    expect(q.text).not.toMatch(/f\.OfferIssueDate/);
  });

});

describe("momentum + league builders", () => {
  // "Written" is COMMISSION, on the same basis as Capricorn's Total Written report. Client fees are
  // returned alongside but must never be summed into it (they silently were until 2026-07-28).
  it("revenueDaily returns commission and client fees as SEPARATE columns", () => {
    const q = revenueDaily("2026-04-06", "2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("GROUP BY CAST(f.WorkflowStatusPreOfferProcessingDate AS date)");
    // ProductCommission, the column Capricorn's own report sums. Was COALESCE(NetCommission, ...)
    // until 2026-08-04; the two differ on 1 of 222 cases, which is a stray unexplained gap to their
    // report - exactly the kind that generates the emails.
    expect(q.text).toMatch(/SUM\(COALESCE\(f\.ProductCommission, 0\)\) AS commission/);
    expect(q.text).not.toContain("NetCommission");
    expect(q.text).toMatch(/SUM\(COALESCE\(f\.ClientFeeAmount, 0\)\) AS clientFees/);
    // The old, conflated expression must not come back.
    expect(q.text).not.toMatch(/ProductCommission, 0\) \+ COALESCE\(f\.ClientFeeAmount/);
  });

  it("revenueByAdviser splits commission from fees too", () => {
    const q = revenueByAdviser("2026-06-01", "2026-06-30");
    expectConventions(q);
    expect(q.text).toContain("AS commission");
    expect(q.text).toContain("AS clientFees");
  });

  // Protection written was hardcoded to £0 until 2026-07-29, understating combined written by
  // ~£24k/wk against a report that includes it.
  it("protectionWrittenDaily reads protectioncase commission on Capricorn's own basis", () => {
    const q = protectionWrittenDaily("2026-06-01", "2026-06-30");
    expectConventions(q);
    expect(q.text).toContain("dbo.protectioncase");
    expect(q.text).toContain("GROUP BY CAST(f.ApplicationDate AS date)");
    expect(q.text).toContain("ProductCommission");
  });

  // vw_total_written_by_product holds LOAN VALUE / POLICY AMOUNT, not commission (verified live
  // 2026-07-29: MortgageWritten == SUM(MortgageValue) to the penny on six separate days). Reading it
  // as a written-commission source would put ~£11.8m on the board where the report reads £112k.
  it("no builder sources written business from vw_total_written_by_product", () => {
    for (const q of [revenueDaily("2026-07-01", "2026-07-31"), protectionWrittenDaily("2026-07-01", "2026-07-31")]) {
      expect(q.text).not.toContain("vw_total_written_by_product");
    }
  });
});

describe("ticker builders never touch the client table", () => {
  for (const [name, q, deletedFlag] of [
    ["applications", applicationEvents("2026-07-05"), true],
    ["leads", leadEvents("2026-07-05"), true],
    ["referrals", referralEvents("2026-07-05"), true],
    ["sales", saleEvents("2026-07-05"), true],
  ] as const) {
    it(`${name} events carry no client join`, () => {
      expectConventions(q, { deletedFlag });
      expect(q.text.toLowerCase()).not.toContain("dbo.client");
    });
  }
});
