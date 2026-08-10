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
  /** Why the status is what it is; the caveat a reader needs. Omitted when genuinely clean. */
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
    label: "Leads",
    definition:
      "A new enquiry entering the pipeline — the first step before anything else. One per lead, not per product.",
    calculation: "Count of distinct leads by the date the lead was created.",
    source: "mortgagecase.LeadDate, COUNT(DISTINCT LeadId)",
    reconcilesTo: "Adviser Lead Report / Daily Lead Flow",
    owner: "Kyle Van Der Net",
    frequency: "Daily",
    status: "agreed",
    note:
      "Verified 2026-07-30: 662 against the platform's client-deduplicated 655 for the same week, under " +
      "1% apart. The platform dedupes to unique clients, so a client with two leads counts once there " +
      "and twice here — that is the whole of the difference. Excludes the ~4,100 leads bulk-dated " +
      "1 Jul 2026 by the CFM migration.",
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
      "Called \"Applications\" until 2026-07-28, which misled: it counts business written, not " +
      "applications submitted to a lender. Until 2026-07-29 it also used a different date field that " +
      "sits 1–21 days earlier, which is why the board and the Total Written Report disagreed. 6.4% of " +
      "cases have never been given this status and are therefore excluded — by us and by Capricorn's " +
      "own report, which requires it.",
  },
  {
    key: "referrals",
    label: "Protection Opportunities",
    definition:
      "A protection case opened — a protection opportunity started for a client. This is NOT a count of " +
      "referrals: Capricorn does not record a protection referral as an event.",
    calculation: "Count of protection cases by the date the case was created.",
    source: "protectioncase.CreatedDate, COUNT(*)",
    reconcilesTo: null,
    owner: "To be confirmed — Kyle Van Der Net",
    frequency: "Daily",
    status: "open",
    note:
      "Called \"Protection Referrals\" until 2026-07-30, when it was found to be counting PaymentShield " +
      "home-insurance quote attempts and currency-exchange referrals — not protection at all. The " +
      "platform's own referral definition (an insurance adviser assigned to the lead) resolves on 3 of " +
      "1,839 cases, so it cannot be used either. TARGET IS NOT VALID: the 25/week was set against the " +
      "old wrong number; opportunities run ~48/week. Awaiting Kyle's ruling on definition and target.",
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
      "Now on Kyle's own basis. Sat 25–31 Jul measured £68,951 of protection commission on 4 Aug, " +
      "against the c.£69K he quoted — and £64,341.82 on 10 Aug, from the same query over the same " +
      "closed week, because two cases left the data. A week's figure is a measurement, not a " +
      "constant: the Reconciliation screen carries each week's full history and flags movement that " +
      "input lag does not explain. It previously keyed on WrittenDate, which gave £48,969 — the " +
      "difference is cases Capricorn counts as submitted that carry no written date yet. Correcting " +
      "an earlier error of ours: we had warned that adopting this basis would remove ~£400k of " +
      "protection commission. It does not. That warning came from reading a sparsely-populated " +
      "workflow date column as though it were the case status; by status, 220 of 248 recent cases " +
      "qualify, not 22 of 227.",
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
      "Until 2026-07-30 this read mortgagecase.OfferIssueDate, which is empty on 97% of cases — July " +
      "showed 66 offers against a true 526. The funnel appeared to collapse between written and offer; " +
      "it does not.",
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
      "Mortgage reconciles: 25–27 Jul = £110,689 against Kyle's £112,083 report run mid-morning on the " +
      "28th, with four advisers matching to the penny. Client fees were silently included until " +
      "2026-07-28, which inflated this against their report. ENTITY SCOPE is the remaining gap and it " +
      "is not an error on either side: this figure covers the Capricorn GROUP, while a Total Written " +
      "Report run inside Capricorn Financial Mortgages covers that entity alone. Sat 25–31 Jul is " +
      "£413,541 group against £381,559 for CFM only. The Reconciliation screen shows both, per week.",
  },
  {
    key: "revenue",
    label: "Est. Revenue",
    definition:
      "An estimate of what the period earned: written commission PLUS client fees. Deliberately a wider " +
      "measure than Weekly Written, and over a different window — this week to date, not last week.",
    calculation:
      "Commission + client fees on business written in the window shown on the tile. COMMISSION is " +
      "the procuration fee the lender or provider pays Capricorn. FEES means the CLIENT fee — the " +
      "advice/arrangement fee charged to the client — and nothing else: solicitor fees and " +
      "miscellaneous fees are recorded separately on the case and are NOT included here.",
    source: "mortgagecase.ProductCommission + mortgagecase.ClientFeeAmount",
    reconcilesTo: "Platform 'Total Fees Due' = ProductCommission + ClientFee (usp_GetInsuranceProductReport)",
    owner: "Kyle Van Der Net",
    frequency: "Daily (week to date)",
    status: "indicative",
    note:
      "Kyle asked directly what the fees are (2026-08-04): they are client fees. The commission and " +
      "fee parts are shown separately on the tile so the gap to Weekly Written is explicit — Weekly " +
      "Written is commission only, because Capricorn's Total Written Report is a commission report. " +
      "That is why the two screens legitimately show different numbers.",
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
      "rather than any single week's figure. It also inherits the 6.4% of mortgage cases excluded from " +
      "Mortgages Written, since it divides by that same count.",
  },
  {
    key: "attach-rate",
    label: "Protection Attach Rate",
    definition:
      "What share of mortgages written also have a protection opportunity — the cross-sell measure.",
    calculation: "Protection opportunities ÷ mortgages written in the same week, as a percentage.",
    source: "Derived from Protection Opportunities and Mortgages Written",
    reconcilesTo: "Referrals report — but note it divides by mortgage OFFERS, not written",
    owner: "To be confirmed — Kyle Van Der Net",
    frequency: "Weekly (Sat–Fri)",
    status: "open",
    note:
      "Two problems, both inherited from Protection Opportunities. The numerator is the metric awaiting " +
      "Kyle's ruling, and the denominator differs from the platform's, which uses offers (115 in W30) " +
      "rather than written (174). Correcting the denominator alone would just produce a different wrong " +
      "number, so both move together once the definition is settled. The 30% target predates all of it.",
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
      "Only as meaningful as the targets underneath it, and no target file has been uploaded yet — every " +
      "target on the board is currently a placeholder derived from trailing averages.",
  },
];

/** Lookup by tile/KPI key. Returns undefined for tiles that have no definition yet — the ⓘ affordance
 *  is then simply not rendered, rather than opening an empty panel. */
export function metricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.key === key);
}
