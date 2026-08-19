// Pure query-builder tests: assert the SQL text carries the firm scoping, deleted-case exclusion
// and date binding conventions, and that params bind what the text references.

import { describe, expect, it } from "vitest";
import { mortgageStageCounts } from "./funnel.js";
import { CLIENT_FIRST_CASE_CTE, kpiDaily, kpiDailyByAdviser, KPI_SPECS } from "./kpis.js";
import { protectionWrittenDaily, revenueDaily } from "./momentum.js";
import { applicationEvents, leadEvents, referralEvents, saleEvents } from "./ticker.js";
import { protectionCommissionByAdviser, revenueByAdviser } from "./advisers.js";
import { KPI_KEYS } from "../../domain/targets.js";
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
  it("covers every KPI with the verified semantics", () => {
    expect(KPI_SPECS.leads.countExpr).toContain("DISTINCT");
    expect(KPI_SPECS.applications.countExpr).toBe("COUNT(*)");
    // Protection Opportunities = protectioncase OPENED. crosssellreferral (PaymentShield quotes +
    // currency exchange) must never come back as the source — see PROTECTION_OPPORTUNITY_NOTE.
    expect(KPI_SPECS.referrals.table).toBe("dbo.protectioncase");
    expect(KPI_SPECS.referrals.dateColumn).toBe("CreatedDate");
    // KPI_KEYS-driven, not a hand-listed four: a KPI added later must inherit this guard rather than
    // quietly escape it.
    for (const kpi of KPI_KEYS) {
      expect(KPI_SPECS[kpi].table, kpi).not.toContain("crosssellreferral");
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

  it("guards the LeadDate-keyed expressions inside mortgageStageCounts, and only those", () => {
    const q = mortgageStageCounts("2026-07-01", "2026-07-31");
    expect(hasGuard(q)).toBe(true);
    // Per-expression, not "everything after the leads stage": BOTH LeadDate-keyed stages (leads and
    // existingCases) must carry the guard, and the two written-status stages must not. Slicing at the
    // first stage boundary used to be enough when leads was the only guarded stage — it isn't now,
    // and loosening it to "the guard appears somewhere" would retire the regression net that exists
    // because guard leakage into written metrics cost 16 cases / £19,592.
    const exprFor = (alias: string): string => {
      const end = q.text.indexOf(`AS ${alias}`);
      const start = q.text.lastIndexOf(",", end - 1) + 1 || q.text.indexOf("SELECT");
      return q.text.slice(start, end);
    };
    for (const guarded of ["leads", "existingCases"]) {
      expect(hasGuard({ text: exprFor(guarded), params: [] }), guarded).toBe(true);
    }
    for (const unguarded of ["applications", "offers"]) {
      expect(exprFor(unguarded), unguarded).not.toContain("@MigOrg0");
    }
  });

  it("guards the existingCases KPI (LeadDate-keyed, same batch)", () => {
    expect(hasGuard(kpiDaily("existingCases", "2026-07-01", "2026-07-31"))).toBe(true);
    expect(hasGuard(kpiDailyByAdviser("existingCases", "2026-07-01", "2026-07-31"))).toBe(true);
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

  // The Momentum commission league is queried per adviser but sits BESIDE the firm graph, so its two
  // halves must be on the same basis as the daily series that graph plots. Verified against the live
  // lake for W33 (8–14 Aug 2026): mortgage £228,973.40 and protection £43,099.23 by adviser, identical
  // to the same figures by day, £272,072.63 combined either way. These assertions are what keep the
  // pair aligned when one side is edited.
  it("the per-adviser commission builders match the daily series they are shown beside", () => {
    const mortgage = revenueByAdviser("2026-08-08", "2026-08-14");
    const daily = revenueDaily("2026-08-08", "2026-08-14");
    expect(mortgage.text).toContain("WorkflowStatusPreOfferProcessingDate");
    expect(daily.text).toContain("WorkflowStatusPreOfferProcessingDate");

    const protection = protectionCommissionByAdviser("2026-08-08", "2026-08-14");
    const protectionDaily = protectionWrittenDaily("2026-08-08", "2026-08-14");
    expectConventions(protection);
    expect(protection.text).toContain("dbo.protectioncase");
    expect(protection.text).toContain("f.ApplicationDate");
    // Same status gate as the daily series — a wider or narrower one here would put the league's rows
    // out of step with the total printed under them.
    for (const q of [protection, protectionDaily]) {
      expect(q.text).toContain("WorkflowStatusId IN ('60', '65', '70', '105', '120')");
    }
    expect(protection.text).toMatch(/SUM\(COALESCE\(f\.ProductCommission, 0\)\) AS commission/);
    // Credited to the case's PRIMARY adviser. The recipient of a commission split is not in the share
    // (PBI 91379), so there is no second credit to give — see SPLIT_RECIPIENT_SOURCE.
    expect(protection.text).toContain("adv.UserAccountKey = f.PrimaryAdviserUserAccountKey");
    expect(protection.text).not.toContain("SplitCommission");
  });

  // Cases are counted per adviser so a league row can say what is behind the money.
  it("both per-adviser builders return a case count", () => {
    expect(revenueByAdviser("2026-08-08", "2026-08-14").text).toContain("COUNT(*) AS cases");
    expect(protectionCommissionByAdviser("2026-08-08", "2026-08-14").text).toContain("COUNT(*) AS cases");
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

// A lead is a NEW CLIENT, not a new case (Capricorn 2026-08-17). The board read 378 for Sat 8 – Wed 12
// Aug against 291 on their own report, which dates a lead by when the CLIENT record was created and so
// never sees a lead for an existing client. These tests pin the shape of that definition — see
// NEW_CLIENT_LEAD_BASIS in domain/data-quality.ts for the full ruling and the measured figures.
describe("leads mean new CLIENTS, not new cases", () => {
  const leadBuilders = () => [
    kpiDaily("leads", "2026-08-08", "2026-08-12"),
    kpiDailyByAdviser("leads", "2026-08-08", "2026-08-12"),
    mortgageStageCounts("2026-08-08", "2026-08-12"),
    leadEvents("2026-08-12"),
  ];

  it("counts DISTINCT CLIENTS, never distinct LeadIds", () => {
    for (const q of [kpiDaily("leads", "2026-08-08", "2026-08-12"), kpiDailyByAdviser("leads", "2026-08-08", "2026-08-12")]) {
      expect(q.text).toContain("COUNT(DISTINCT f.PrimaryClientKey)");
      // COUNT(DISTINCT LeadId) is the OLD definition — it counted a remortgage of a ten-year client as
      // new lead flow, which is the whole reason this changed.
      expect(q.text).not.toContain("COUNT(DISTINCT f.LeadId)");
    }
  });

  it("restricts every lead-counting builder to the client's FIRST case", () => {
    for (const q of leadBuilders()) {
      expect(q.text).toContain("clientFirstCase");
      expect(q.text).toMatch(/fc\.firstDay IS NULL OR fc\.firstDay >= f\.LeadDate/);
    }
  });

  it("derives first-appearance across all three case types, not mortgages alone", () => {
    // A client who arrived via a protection or GI case is NOT a new lead when they later take a
    // mortgage (Capricorn's ruling on the ambiguous case). Miss a table here and those clients would
    // silently start counting as new.
    const q = kpiDaily("leads", "2026-08-08", "2026-08-12");
    for (const table of ["dbo.mortgagecase", "dbo.protectioncase", "dbo.generalinsurancecase"]) {
      expect(q.text, table).toContain(table);
    }
  });

  it("joins client identity LEFT, so an unresolvable client cannot vanish from the count", () => {
    // PrimaryClientKey is never NULL in this feed today; an INNER join would nonetheless silently drop
    // whole days of lead flow if that ever changed upstream.
    for (const q of leadBuilders()) {
      expect(q.text).toContain("LEFT JOIN clientFirstCase fc");
      expect(q.text).not.toMatch(/(?<!LEFT )JOIN clientFirstCase/);
    }
  });

  it("keeps the first-case CTE parameter-free so it cannot collide with the outer query's binds", () => {
    // The CTE is inlined into builders that already bind @Org0/@Org1/@From/@To (and @D in the ticker).
    // Any param of its own would either duplicate a name or go unbound — expectConventions catches
    // both, so run it across every builder that inlines the CTE.
    for (const q of leadBuilders()) expectConventions(q);
    expect(CLIENT_FIRST_CASE_CTE).not.toContain("@");
  });

  it("scopes the CTE to live cases but NOT to one entity", () => {
    // Client identity spans both Capricorn entities: a client whose first case sat in the Consultancy
    // is not new when Mortgages opens their second.
    expect(CLIENT_FIRST_CASE_CTE).toContain("COALESCE(DeletedYN, 'N') <> 'Y'");
    expect(CLIENT_FIRST_CASE_CTE).not.toContain("OrganisationKey");
  });
});

describe("existingCases is the exact complement of leads", () => {
  it("counts CASES (not clients) for clients whose first case predates this one", () => {
    for (const q of [kpiDaily("existingCases", "2026-08-08", "2026-08-12"), kpiDailyByAdviser("existingCases", "2026-08-08", "2026-08-12")]) {
      expectConventions(q);
      expect(q.text).toContain("COUNT(*)");
      expect(q.text).toContain("fc.firstDay < f.LeadDate");
    }
  });

  it("partitions the same population as leads — no case in both legs, none in neither", () => {
    // The two extraClauses must be strict complements over the same rows, or the split silently
    // loses or double-counts work. Compared as text because these are pure builders.
    expect(KPI_SPECS.leads.extraClause).toBe("(fc.firstDay IS NULL OR fc.firstDay >= f.LeadDate)");
    expect(KPI_SPECS.existingCases.extraClause).toBe("fc.firstDay < f.LeadDate");
    expect(KPI_SPECS.existingCases.dateColumn).toBe(KPI_SPECS.leads.dateColumn);
    expect(KPI_SPECS.existingCases.table).toBe(KPI_SPECS.leads.table);
  });

  it("is surfaced by the funnel alongside the stages, not as one of them", () => {
    // Existing-client work enters the pipeline part-way along; folding it into the leads stage would
    // inflate every conversion denominator on Funnel Health.
    expect(mortgageStageCounts("2026-08-08", "2026-08-12").text).toContain("AS existingCases");
  });
});
