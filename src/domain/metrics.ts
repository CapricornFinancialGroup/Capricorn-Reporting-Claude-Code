// THE metric dictionary — one definition per KPI, and the only place a definition is written down.
//
// Conor, 2026-08-04: "Every KPI should have a single agreed definition, together with its calculation,
// source, owner and reporting frequency… I would like every KPI to be clickable so users can
// immediately understand exactly what they are looking at… Our objective should be that nobody ever
// needs to send an email asking why one number differs from another."
//
// That objective is only achievable if there is exactly ONE definition per metric. So this registry is
// the single source, and everything else renders from it:
//   • the ⓘ panel behind every tile on every screen  (web/src/components/MetricInfo.tsx)
//   • the Glossary page                              (web/src/pages/Glossary.tsx)
//   • the /api/reporting/definitions payload, which is what a written dictionary should be generated
//     from rather than hand-maintained alongside the code (that is how definitions drift)
//
// `status` is deliberately part of the contract. Half of the July/August email traffic came from
// figures that were presented as settled when they were not, so a metric that is indicative or
// disputed says so wherever it appears, rather than only in a README nobody on Capricorn's side reads.
// It is shown as a badge inside the ⓘ panel. It no longer colours the ⓘ button itself — eleven of
// nineteen metrics are indicative or open, so that painted most of the board's buttons red and turned
// a "read me" affordance into an alarm (Capricorn, 2026-08-20).

/** How much confidence the board is claiming for a figure. Rendered as a badge on the tile. */
export type MetricStatus =
  /** Reconciles to Capricorn's own report, or is definitionally unambiguous. */
  | "agreed"
  /** Usable, but the definition or basis has an open question against it. */
  | "indicative"
  /** Actively disputed or awaiting a Capricorn ruling — do not make decisions on it yet. */
  | "open";

export interface MetricDefinition {
  /** Stable key. Matches the KPI/tile key the screens already use where one exists. */
  key: string;
  /** The on-screen label. Must match KPI_LABELS / tile titles exactly. */
  label: string;
  /** Plain English — what a reader of the board should understand this to mean. No jargon. */
  definition: string;
  /** How it is actually computed, in business terms first and column names second. */
  calculation: string;
  /** Which table/column in the Capricorn data share. */
  source: string;
  /** Which Capricorn/Smartr365 report this is meant to agree with, if any. */
  reconcilesTo: string | null;
  /** Who owns the DEFINITION (not the performance). "To be confirmed" where Capricorn hasn't said. */
  owner: string;
  /** How often the figure changes. */
  frequency: string;
  status: MetricStatus;
  /**
   * The caveat a reader needs in order to read TODAY's figure correctly — a scope, an exclusion, a
   * limit. Omitted when genuinely clean.
   *
   * NOT a change history. These notes accumulated one for every argument the metric had been through
   * ("called X until 28 Jul", "the board read 378 against their 291", "correcting an earlier error of
   * ours") until the panel was more changelog than dictionary. Capricorn, 2026-08-20: "take away the
   * running commentary of why we've got them there. Just provide factual information about what that
   * tile means rather than the justification of what happened." Git holds the history. The test for
   * whether a sentence belongs here is whether someone reading the number on screen right now would
   * get it wrong without it.
   */
  note?: string;
}

/** The refresh reality, stated once and shown on every screen header. */
export const DATA_CADENCE = {
  /** Plain-English answer to "is this live?" — asked three times between 2026-07-28 and 08-03. */
  summary:
    "Not real-time, but not nightly either. The data share reloads FIVE times a day — around 07:50, " +
    "11:10, 14:15, 17:10 and 20:10 — so business written at 3pm reaches the board at the 17:10 load, " +
    "about two hours later. The header shows the exact time of the last load.",
  /** Why the chase measures through the last COMPLETE day even though today is partly loaded. */
  asOfRule:
    "Target comparisons are measured through the last COMPLETE day. Today is only partly loaded until " +
    "its final load of the evening, and treating a part-loaded day as finished previously made the " +
    "board read 1 lead and 0 applications — both flagged critical — while reporting the firm a full " +
    "day of target further behind than it was. Today is not hidden, though: each KPI card carries a " +
    "separate \"Today so far\" count, stamped with the load that produced it. It has no target beside " +
    "it on purpose — a part-day measured against a whole-day target would drift behind all morning " +
    "and recover by evening.",
  refresh: "5× daily (≈07:50, 11:10, 14:15, 17:10, 20:10), screens poll every 60s",
} as const;

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: "leads",
    label: "New Client Leads",
    definition:
      "A NEW CLIENT entering the pipeline — someone Capricorn has not dealt with before. Work opened for " +
      "a client already on the books (a remortgage, a repeat client, a second application) is not lead " +
      "flow; it is counted separately as Existing Client Cases. One per client, not per product.",
    calculation:
      "Count of distinct clients whose FIRST case on the platform — across mortgage, protection and " +
      "general insurance — falls in the window, by the date the lead was created.",
    source: "mortgagecase.LeadDate, COUNT(DISTINCT PrimaryClientKey) where this is the client's first case",
    reconcilesTo: "Lead Flow Report (usp_LeadsReport)",
    owner: "Kyle Van Der Net",
    frequency: "Daily",
    status: "agreed",
    note:
      "Group-wide: both Capricorn entities, every adviser. A Lead Flow Report run in the platform is " +
      "scoped to the advisers the person running it can see, and requires a live mortgage product " +
      "attached, so it will read lower. Excludes the ~4,100 leads bulk-dated 1 Jul 2026 by the CFM " +
      "migration. The 633/week target was set against a wider count that included existing-client " +
      "cases, so it sits about 16% above what this measures.",
  },
  {
    key: "existingCases",
    label: "Existing Client Cases",
    definition:
      "A case opened for a client Capricorn already has — remortgages above all, plus repeat clients and " +
      "second applications. Real work, and the other half of what used to be lumped into \"Leads\", but " +
      "not new business won.",
    calculation:
      "Count of mortgage cases created in the window whose client had an earlier case on the platform. " +
      "Counts CASES, not clients: one client bringing two remortgages is two.",
    source: "mortgagecase.LeadDate, COUNT(*) where the client's first case predates this one",
    reconcilesTo: null,
    owner: "To be confirmed — Kyle Van Der Net",
    frequency: "Daily",
    status: "open",
    note:
      "No target set, so this carries no ahead/behind verdict — the figure and its trend only. Counts " +
      "cases rather than clients, so one client bringing two remortgages counts twice. Typically runs " +
      "80–250 a week, the peaks tracking remortgage batches.",
  },
  {
    key: "applications",
    label: "Mortgages Written",
    definition:
      "A mortgage written. \"Written\" means formally submitted for processing — NOT approved, funded or " +
      "completed, and it can still fall through. Two products for one client count as two.",
    calculation:
      "Count of mortgage products by the date the case reached the status 'Pre-offer Processing' — the " +
      "same trigger Capricorn's Total Written Report uses.",
    source: "mortgagecase.WorkflowStatusPreOfferProcessingDate (status 70), COUNT(*)",
    reconcilesTo: "Total Written Report (usp_GetTotalProductReport)",
    owner: "Kyle Van Der Net",
    frequency: "Daily",
    status: "agreed",
    note:
      "6.4% of mortgage cases have never been given this status and are therefore not counted — here " +
      "or on Capricorn's own report, which requires it too. Group-wide: a Total Written Report run " +
      "inside one entity covers that entity alone and will read lower.",
  },
  {
    key: "referrals",
    label: "Protection Referrals",
    definition:
      "A protection case opened for a client. ⚠ READ THE NAME WITH CARE: despite the label, this is not " +
      "a count of referral EVENTS — Capricorn does not record a referral as an event anywhere — it is " +
      "protection cases created. The two are close in practice but not the same thing.",
    calculation: "Count of protection cases by the date the case was created.",
    source: "protectioncase.CreatedDate, COUNT(*)",
    reconcilesTo: null,
    owner: "To be confirmed — Kyle Van Der Net",
    frequency: "Daily",
    status: "open",
    note:
      "A true referral count is not available from the platform: its own referral field (an insurance " +
      "adviser assigned to the lead) is populated on 3 of 1,839 cases. Protection cases opened is the " +
      "closest measure that exists. The 25/week target was set against a different, narrower figure; " +
      "cases opened run around 48/week, so the RAG verdict on this tile is not meaningful yet.",
  },
  {
    key: "sales",
    label: "Protection Sales",
    definition: "A protection policy written, following on from an opportunity.",
    calculation:
      "Count of protection cases by their Application Date — which the platform labels 'Date " +
      "Submitted' — counting cases that have reached submission or beyond.",
    source: "protectioncase.ApplicationDate, WorkflowStatusId in 60/65/70/105/120, COUNT(*)",
    reconcilesTo: "Total Written Report, insurance leg (usp_GetInsuranceProductReport)",
    owner: "Kyle Van Der Net",
    frequency: "Daily",
    status: "agreed",
    note:
      "A closed week's figure is a measurement, not a constant — cases are entered late, and cases " +
      "already counted are sometimes removed, so the same week re-queried a fortnight later can differ " +
      "in either direction. The Reconciliation screen holds every value each week has reported.",
  },
  {
    key: "offers",
    label: "Offers",
    definition:
      "A lender has issued a formal mortgage offer. One step past written, still not the finish line.",
    calculation: "Count of mortgage products by the date the case reached 'Post-offer Processing'.",
    source: "mortgagecase.WorkflowStatusPostOfferProcessingDate (status 100), COUNT(*)",
    reconcilesTo: "Referrals report (GetConversionRateForInsuranceReferrals), which treats status 100 as offer-issued",
    owner: "Kyle Van Der Net",
    frequency: "Daily",
    status: "agreed",
    note:
      "Offers arrive weeks after the business is written, so in a one-week window this stage reads low " +
      "against the written figure above it — that is the lag, not a drop-off in the funnel.",
  },
  {
    key: "written",
    label: "Weekly Written",
    definition:
      "Written business, as commission. Mortgage commission plus protection commission. Client fees are " +
      "NOT included, because Capricorn's Total Written Report is a commission report.",
    calculation:
      "Mortgage: product commission on cases reaching 'Pre-offer Processing' in the week. " +
      "Protection: product commission on cases submitted in the week. Summed, excluding fees.",
    source: "mortgagecase.ProductCommission + protectioncase.ProductCommission",
    reconcilesTo: "Total Written Report (usp_GetTotalProductReport)",
    owner: "Kyle Van Der Net",
    frequency: "Weekly (Sat–Fri), reported for the last COMPLETE week",
    status: "indicative",
    note:
      "Covers the Capricorn GROUP. A Total Written Report run inside one entity covers that entity " +
      "alone: for Sat 25–31 Jul that is £413,541 group against £381,559 for CFM. Both are shown per " +
      "week on the Reconciliation screen. A week within a fortnight of its end is marked provisional " +
      "and can still move in either direction.",
  },
  {
    key: "revenue",
    label: "Written Commission",
    definition:
      "Commission written in the period: mortgage plus protection. The same pair Capricorn's Total " +
      "Written Report shows, over a different window — this week to date, not last week. Client fees " +
      "are NOT included.",
    calculation:
      "Mortgage commission + protection commission on business written in the window shown on the " +
      "tile. COMMISSION is the procuration fee the lender or provider pays Capricorn. The CLIENT fee " +
      "— the advice/arrangement fee the adviser enters on the case — is shown beside the total but " +
      "is not added to it. Solicitor and miscellaneous fees are recorded separately and excluded " +
      "entirely.",
    source: "mortgagecase.ProductCommission + protectioncase.ProductCommission (ClientFeeAmount shown separately)",
    reconcilesTo: "Platform 'Total Fees Due' = ProductCommission + ClientFee (usp_GetInsuranceProductReport)",
    owner: "Kyle Van Der Net",
    frequency: "Daily (week to date)",
    status: "indicative",
    note:
      "Client fees sit beside this total, not inside it, so it stays on the same basis as Capricorn's " +
      "Total Written Report. The fee is adviser-entered and 37% of written cases carry none, so the " +
      "figure shown beside the total understates what was actually charged.",
  },
  {
    key: "total-lending",
    label: "Total Lending",
    definition:
      "The loan value of mortgages written — pounds of lending. NOT commission and NOT the Written figure.",
    calculation: "Sum of mortgage loan value on cases written in the reporting week.",
    source: "mortgagecase.MortgageValue",
    reconcilesTo: null,
    owner: "Kyle Van Der Net",
    frequency: "Weekly (Sat–Fri), week to date",
    status: "agreed",
  },
  {
    key: "case-size",
    label: "Avg Case Size",
    definition: "Average loan value per mortgage written in the week.",
    calculation: "Total loan value ÷ number of mortgages written. Indicative — a mean, so a few large cases move it.",
    source: "mortgagecase.MortgageValue ÷ COUNT(*)",
    reconcilesTo: null,
    owner: "To be confirmed",
    frequency: "Weekly (Sat–Fri)",
    status: "indicative",
    note:
      "A mean, not a median, so two or three large cases move it noticeably in a week — read the trend " +
      "rather than a single week. Divides by the Mortgages Written count, so it inherits that measure's " +
      "6.4% exclusion.",
  },
  {
    key: "attach-rate",
    label: "Protection Attach Rate",
    definition:
      "What share of mortgages written also have a protection case opened — the cross-sell measure.",
    calculation: "Protection cases opened ÷ mortgages written in the same week, as a percentage.",
    source: "Derived from Protection Referrals and Mortgages Written",
    reconcilesTo: "Referrals report — but note it divides by mortgage OFFERS, not written",
    owner: "To be confirmed — Kyle Van Der Net",
    frequency: "Weekly (Sat–Fri)",
    status: "open",
    note:
      "Not comparable with the platform's referrals report, which divides by mortgage OFFERS rather " +
      "than mortgages written — a smaller denominator, so a higher percentage. The numerator carries " +
      "the Protection Referrals caveat, and the 30% target was set against neither basis.",
  },
  {
    key: "commission-league",
    label: "Top 10 Commission Earners",
    definition:
      "The ten advisers who earned the most commission in the week shown — the same week, and the same " +
      "money, as the Weekly Written graph beside it. Every product line counts: mortgage, protection and " +
      "general insurance commission are added together, not split.",
    calculation:
      "Commission on business written in the week, summed per adviser and ranked. Mortgage: product " +
      "commission on cases reaching 'Pre-offer Processing' in the week. Protection: product commission " +
      "on cases submitted in the week. Client fees are NOT included. Cases with no adviser on file hold " +
      "no place in the league but remain inside the week's total, which is printed beneath it.",
    source: "mortgagecase.ProductCommission + protectioncase.ProductCommission, by PrimaryAdviserUserAccountKey",
    reconcilesTo: "Total Written Report (usp_GetTotalProductReport) at FIRM level, not per adviser",
    owner: "Kyle Van Der Net",
    frequency: "Weekly (Sat–Fri), reported for the last COMPLETE week",
    status: "indicative",
    note:
      "The week's TOTAL reconciles; an individual ROW may not. Where commission is SPLIT, this credits " +
      "the case's primary adviser in full, while the platform divides it and gives the recipient their " +
      "own row — so a split case can put up to a few thousand pounds against the wrong name here. The " +
      "recipient field is not in the data share. Headed \"mortgages\" but counts every product line.",
  },
  {
    key: "pace",
    label: "% of Pace",
    definition:
      "How an office's results compare with what was expected by this point in the week. 100% means " +
      "exactly on track for the point the week has reached.",
    calculation:
      "Average of (actual ÷ expected-so-far) across the four KPIs, ×100. Expected-so-far uses the " +
      "weighted day curve: Mon–Thu each carry a fifth of the week, Friday slightly less.",
    source: "Derived from the four KPIs and the weekly targets",
    reconcilesTo: null,
    owner: "Conor Murphy",
    frequency: "Daily",
    status: "indicative",
    note:
      "Only as meaningful as the targets underneath it. Each screen states whose targets it is using; " +
      "where a measure has no Capricorn target the figure beneath is our estimate, and the pace over " +
      "it inherits that. Measured through the last COMPLETE day, so it does not dip every morning.",
  },
];

/** Lookup by tile/KPI key. Returns undefined for tiles that have no definition yet — the ⓘ affordance
 *  is then simply not rendered, rather than opening an empty panel. */
export function metricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.key === key);
}
