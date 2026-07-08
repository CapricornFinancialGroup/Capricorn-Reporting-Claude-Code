// Pure query-builder tests: assert the SQL text carries the firm scoping, deleted-case exclusion
// and date binding conventions, and that params bind what the text references.

import { describe, expect, it } from "vitest";
import { agedApplications, actionQueues, mortgageStageCounts } from "./funnel.js";
import { kpiDaily, kpiDailyByAdviser, KPI_SPECS } from "./kpis.js";
import { revenueDaily } from "./momentum.js";
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

describe("kpi builders", () => {
  it("covers all four KPIs with the verified semantics", () => {
    expect(KPI_SPECS.leads.countExpr).toContain("DISTINCT");
    expect(KPI_SPECS.applications.countExpr).toBe("COUNT(*)");
    // Referrals come from crosssellreferral — the mortgagecase referral flags are unpopulated
    // for Capricorn (verified live 2026-07-06).
    expect(KPI_SPECS.referrals.table).toBe("dbo.crosssellreferral");
    expect(KPI_SPECS.referrals.extraClause).toContain("AdviserDeclinedYN");
    expect(KPI_SPECS.sales.table).toContain("protectioncase");
  });

  it("referral queries skip the DeletedYN convention (column doesn't exist on the fact)", () => {
    const q = kpiDaily("referrals", "2026-07-01", "2026-07-05");
    expectConventions(q, { deletedFlag: false });
    expect(q.text).not.toContain("DeletedYN");
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

describe("funnel builders", () => {
  it("mortgageStageCounts counts leads, applications and offers in one pass", () => {
    const q = mortgageStageCounts("2026-07-01", "2026-07-05");
    expectConventions(q);
    for (const col of ["LeadDate", "WrittenDate", "OfferIssueDate"]) {
      expect(q.text).toContain(col);
    }
  });

  it("aged applications look back 90 days and exclude offered cases", () => {
    const q = agedApplications("2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("OfferIssueDate IS NULL");
    expect(q.text).toContain("DATEADD(day, -90, @AsOf)");
  });

  it("action queues cover the strawman buttons (REFER NOW derives in the dataset layer)", () => {
    const q = actionQueues("2026-07-05", "2026-07-01");
    expectConventions(q);
    for (const alias of ["callNow", "followUp", "chaseLender", "writtenLeads"]) expect(q.text).toContain(alias);
  });
});

describe("momentum + league builders", () => {
  it("revenueDaily groups written revenue by day", () => {
    const q = revenueDaily("2026-04-06", "2026-07-05");
    expectConventions(q);
    expect(q.text).toContain("GROUP BY CAST(f.WrittenDate AS date)");
  });

  it("revenueByAdviser sums commission and fees per adviser", () => {
    const q = revenueByAdviser("2026-06-01", "2026-06-30");
    expectConventions(q);
    expect(q.text).toContain("ClientFeeAmount");
  });
});

describe("ticker builders never touch the client table", () => {
  for (const [name, q, deletedFlag] of [
    ["applications", applicationEvents("2026-07-05"), true],
    ["leads", leadEvents("2026-07-05"), true],
    ["referrals", referralEvents("2026-07-05"), false],
    ["sales", saleEvents("2026-07-05"), true],
  ] as const) {
    it(`${name} events carry no client join`, () => {
      expectConventions(q, { deletedFlag });
      expect(q.text.toLowerCase()).not.toContain("dbo.client");
    });
  }
});
