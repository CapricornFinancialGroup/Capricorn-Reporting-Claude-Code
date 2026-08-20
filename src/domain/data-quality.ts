// Data-quality exclusions — known one-off data events that would distort the run chase.
//
// The Capricorn Financial Mortgages (org 486) back-book was migrated onto the platform at go-live
// and ~4,094 historical leads were bulk-stamped with LeadDate = 2026-07-01 (vs a normal ~120/day).
// They're real leads but mis-dated to the migration date, so counting them as "new leads on 1 Jul"
// makes the week read ~34× high. We exclude that batch from mortgagecase metrics.
//
// Versioned + documented on purpose (not a magic literal in SQL). Extend the list if further bulk
// events land; remove an entry if Capricorn confirms a batch should count.

export interface MigrationExclusion {
  orgKey: number;
  /** YYYY-MM-DD — the LeadDate the batch was stamped with. */
  leadDate: string;
  note: string;
}

export const MIGRATION_EXCLUSIONS: MigrationExclusion[] = [
  { orgKey: 486, leadDate: "2026-07-01", note: "CFM go-live back-book migration (~4,094 leads bulk-dated 1 Jul)" },
];

/**
 * Days after a week ends before its WrittenDate-keyed figures can be treated as settled.
 *
 * Cases are entered on the platform well after the date they were written. Measured on the live
 * lake 2026-07-29 (mortgagecase, both Capricorn orgs, WrittenDate ≥ 1 May 2026, n=1,745):
 *
 *   same day  36%   |  1–3 days  16%  |  4–7 days  18%  |  8–30 days  28%  |  31+ days  2%
 *   mean lag  6.0 days
 *
 * By value (WrittenDate ≥ 1 Jun): only 52% of written commission+fees lands within a day of the
 * written date; 22% arrives 8 or more days late.
 *
 * Consequence, and the reason this constant exists: W30 (18–24 Jul) reported £266.3k written and
 * 133 mortgages written on 28 Jul, and £299.6k / 147 on 29 Jul — up 12.5% in 24 hours, still
 * climbing. Presenting a just-closed week as final produced Kyle's 2026-07-28 challenge. Anything
 * inside this window is flagged `provisional` so the board says so on its face.
 *
 * NOW VERIFIED on the current basis, and the answer is DO NOT SHORTEN IT. The figures above were
 * measured while the board keyed on `WrittenDate`, which the platform backdates; MORTGAGE_WRITTEN_DATE
 * (below) is a workflow status-change date recorded when the status actually moves, and the
 * expectation was that it would prove materially more stable. It has not. Read off the week snapshots
 * on 2026-08-20, covering every closed week observed since 10 Aug:
 *
 *   25–31 Jul   mortgage commission £413,540.51 → £414,283.12 across six observations, the last of
 *               them on 19 Aug — day 19, i.e. AFTER this window closes. Protection cases 28 → 29.
 *   1–7 Aug     mortgage cases 167 → 166, mortgage commission −£981.74, protection commission
 *               £21,650.93 → £20,064.71 (−7.3%), client fees −£301. Every figure DOWN.
 *   8–14 Aug    mortgage commission −£219.93, client fees −£200. Both DOWN.
 *
 * Two conclusions. First, 14 days is if anything too short, not too long. Second, the movement is not
 * only late entry arriving — three of the four measures on the 1–7 Aug week FELL, which is business
 * leaving a closed week (see services/snapshots/history.ts). A `reduced` severity exists for exactly
 * that and it is firing on real data.
 *
 * 14 days ≈ the point the lag distribution above has substantially settled (~70% within 7 days). It
 * remains a judgement call rather than a threshold read off a settle curve; what has changed is that
 * the cautious direction is now the evidenced one.
 */
export const INPUT_LAG_SETTLE_DAYS = 14;

/**
 * The column that means "a mortgage was written", matching Capricorn's own Total Written Report.
 *
 * That report is `usp_GetTotalProductReport` in the platform (Occfinance.Database). It does NOT read
 * a written-date field: it joins `FinanceStatusDate` and keys on the date a product ENTERED the
 * status `'Pre-offer Processing'` (FinanceStatusId 70). The Gold ETL exposes that as
 * `mortgagecase.WorkflowStatusPreOfferProcessingDate`.
 *
 * `mortgagecase.WrittenDate` is a DIFFERENT date. The Gold load builds it as
 * `COALESCE(SubmissionDate when plausible, <status-70 date>)`, so `SubmissionDate` wins wherever it
 * is set — and it usually sits EARLIER: of ~900 recent cases only 323 share the same day, the rest
 * skew 1–21 days earlier. That single difference is why the dashboard could not be reconciled to the
 * report (Kyle 2026-07-28).
 *
 * Proof, 25–28 Jul 2026 against Kyle's screenshot (£112,083 mortgage commission, org 486):
 *
 *   basis                                  cases   commission
 *   WrittenDate (what the board used)         28      £49,166   ← nothing like his figure
 *   status 70, org 486, 25–27 Jul             60     £110,689   ← his report ran 09:41 on the 28th
 *
 * Four advisers tie to the penny on this basis — Albano Toska £22,225.43, Ross Culley £4,668.00,
 * Toby Scott-Mason £3,367.22, Jacob Furniss £3,388.00 — and the adviser SET matches his report,
 * where the WrittenDate basis shared barely a name with it.
 *
 * ⚠ Trade-off, accepted deliberately: 112 of 1,745 recent mortgage cases (6.4%, £178k commission)
 * have no status-70 date and are therefore EXCLUDED. That is exactly what the platform report does
 * — it inner-joins the status — so matching it means matching that exclusion too. Raise the 6.4% as
 * a data-quality item with Capricorn rather than papering over it with a fallback, which would put
 * the board back out of step with the report.
 */
export const MORTGAGE_WRITTEN_DATE = "WorkflowStatusPreOfferProcessingDate";

/**
 * Protection written keys on `protectioncase.ApplicationDate` — which the platform itself labels
 * "Date Submitted" (`usp_GetInsuranceProductReport`, `[DateSubmitted] = FinanceInsurance.ApplicationDate`).
 *
 * This is Capricorn's basis. Kyle, 2026-08-04: "as of last week we wrote c.£69K of protection
 * business… something doesn't seem right." He was right. Sat 25–31 Jul 2026, measured 2026-08-04:
 *
 *   basis                                    cases   commission
 *   WrittenDate (what the board used)           24     £48,969
 *   CreatedDate                                 42     £25,825
 *   ApplicationDate + status 60/65/70           30     £68,951   ← his figure
 *
 * Switching basis moves NO case between weeks: ApplicationDate equals WrittenDate on all 248 cases
 * where WrittenDate is set. It only ADDS the cases that have been submitted but carry no WrittenDate
 * yet — which is precisely the business Capricorn counts and we were dropping.
 *
 * ⚠ THAT £68,951 IS A MEASUREMENT, NOT A CONSTANT — and it has since moved. Re-run on 2026-08-10,
 * same query, same week, no code change: 28 cases, £64,341.82. Every surviving row in the week has
 * `_etl_modified` ≤ 31 Jul, so nothing was revised — two written-status cases worth £4,609.18 left
 * the share entirely (deleted upstream, or dropped by the ETL; the Gold layer cannot tell which).
 *
 * The lesson is not about protection. It is that a closed week's figure is not stable, that
 * `MAX(_etl_modified)` cannot detect a row that VANISHES, and that quoting any single-week number to
 * Capricorn without re-running it that day is how we ended up asserting an exact match that had
 * stopped being true six days earlier. `services/snapshots/` now records every closed week's value
 * on a timer and flags movement input lag doesn't explain; the Reconciliation screen shows it.
 *
 * ⚠ THE MISTAKE THIS CORRECTS, so it isn't repeated. Until 2026-08-04 the note here claimed status 65
 * was "populated for only 50 of 246 recent protection cases (20%)", and on that basis I warned Kyle
 * that adopting his definition would delete ~£400k of protection commission. That was wrong. It read
 * the sparse workflow DATE column `WorkflowStatusSubmittedtoUnderwriters` (64 of 248 populated) as if
 * it were the status. The status itself lives in `WorkflowStatusId`, and it is 65 on 220 of 248 —
 * 89%. NEVER infer "has this case reached status X" from a WorkflowStatus*Date column in this feed;
 * those dates are unreliably populated. Use `WorkflowStatusId`.
 */
export const PROTECTION_WRITTEN_DATE = "ApplicationDate";

/**
 * Statuses that count as protection written. The platform's own total written sums `FinanceStatusId
 * IN (60,65,70)` (`usp_Dashboard_GetMyTotalWritten`), matched on the date each status was REACHED —
 * so a case now sitting at Completed still counts, from the day it was submitted. `WorkflowStatusId`
 * in the lake is the CURRENT status only, so the set is widened to everything at or beyond
 * submission — 105 Terms Offered and 120 Completed included — to avoid dropping cases that have
 * simply moved on. For Sat 25–31 Jul this is identical to the strict 60/65/70 set — verified on both
 * 2026-08-04 (30 cases, £68,951) and again on 2026-08-10 (28 cases, £64,341.82), i.e. the widening
 * held identical across the very revision that moved the total. It only ever protects completed
 * business.
 */
export const PROTECTION_WRITTEN_STATUSES = ["60", "65", "70", "105", "120"] as const;

/**
 * PER-ADVISER PROTECTION CREDIT — the 60/40 split, and exactly what is missing.
 *
 * Kyle has asked three times how his Written Report can credit a protection adviser when we say we
 * cannot ("it should be visible as it is on our written report. Please Investigate", 2026-08-10).
 * Traced through the platform source, and he is right — the recipient IS recorded, just not in our
 * copy. `usp_GetFinancialProductReport` (Occfinance.Database) resolves it in two passes:
 *
 *   1. the originating adviser's row nets the split off:
 *        AdviserCommission  = F.commission - SC.Commission
 *        SplitCommBrokerId  = SC.ToAdviserId      ← the recipient, named
 *   2. a SECOND row is emitted for the recipient themselves:
 *        INNER JOIN dbo.tblSplitCommission SC ON SC.ToAdviserId = uSC.userid
 *        AdviserCommission = SC.Commission
 *
 * Pass 2 is why Michael Ngoka appears on Kyle's Total Written Report with £13,948 of protection
 * commission while not being the primary adviser on those cases.
 *
 * ⚠ CORRECTING MY OWN CORRECTION. On 2026-08-10 I told Kyle the recipient field "is empty on all of
 * them". That was wrong, and it walked back an earlier statement that had been RIGHT. The chain:
 *   - `dbo.tblSplitCommission` (FinanceId, ToAdviserId, Commission) holds the split and its
 *     recipient. It is NOT in the Gold share — that is the whole of PBI 91379, correctly specified.
 *   - `protectioncase.SplitCommission` in our feed is a derived copy of the AMOUNT only.
 *   - `protectioncase.SplitAdviserUserAccountKey` is NULL on every split case, and
 *     `ReferringAdviserUserAccountKey` carries a firm-level sentinel (the negated OrganisationKey,
 *     e.g. -486) on 23 of 24 — so neither is the recipient, and neither is what the platform uses.
 *   - Therefore "the referral field is only populated on 1 in 5 cases" is TRUE but IRRELEVANT to the
 *     split: the platform never reads it for this. Do not cite it as the blocker again.
 *
 * The ask is one column: `tblSplitCommission.ToAdviserId` (with FinanceId and Commission) in the
 * share. Until then per-adviser protection on the Adviser League cannot match the Written Report,
 * and firm totals are unaffected.
 */
export const SPLIT_RECIPIENT_SOURCE = "dbo.tblSplitCommission.ToAdviserId (NOT in the Gold share — PBI 91379)" as const;

/**
 * The column that means "a mortgage offer was issued", matching the platform's own reports.
 *
 * The platform treats reaching status **100** as offer-issued — `GetConversionRateForInsuranceReferrals`
 * literally declares `@MortgageOfferIssuedStatusId = 100`. Status 100 is named 'Post-offer Processing'
 * (`0000_insert-FinanceStatus.sql`), and the Gold ETL exposes its date as
 * `mortgagecase.WorkflowStatusPostOfferProcessingDate`.
 *
 * The dashboard used `mortgagecase.OfferIssueDate` instead. That column is NULL on 24,458 of 25,116
 * Capricorn cases created since 1 Jan 2026 — **97% empty** — so it was never a viable source:
 *
 *   July 2026 offers, OfferIssueDate (what the funnel showed):        66
 *   July 2026 offers, status 100 (what the platform reports):        526   ← 8× more
 *
 * Funnel Health therefore showed 604 written collapsing to 61 offers — a catastrophic-looking leak
 * that was pure measurement error. Verified live 2026-07-30.
 */
export const MORTGAGE_OFFER_DATE = "WorkflowStatusPostOfferProcessingDate";

/**
 * Why the protection KPI is "Opportunities" (protection cases opened) and not "Referrals".
 *
 * Until 2026-07-30 the referrals KPI read `dbo.crosssellreferral`. That table is not protection at
 * all — the Gold load unions three cross-sell integrations, and for Capricorn in July it held 112
 * PaymentShield **quote** events (home insurance) plus 8 SmartCurrencyExchange (currency) referrals,
 * and zero protection referrals. The KPI reported 110 of those as July's protection referrals. It
 * went unnoticed because the wrong number (~24/wk) sat close to the 25/wk target.
 *
 * The platform's own Referrals report (`GetConversionRateForInsuranceReferrals`) defines a protection
 * referral as `tblLead.InsuranceAdviser > 0`. Capricorn does not use that workflow: the field resolves
 * on 3 of 1,839 written mortgage cases over three months and 0 in W30, so their in-platform Referrals
 * report is near-empty too. Bringing `InsuranceAdviser` into the share would deliver an empty column —
 * it is not a pipeline gap, it is a behaviour Capricorn does not record.
 *
 * What they DO record is protection cases. Weekly, `protectioncase` created: 70 / 51 / 42 / 46 / 49
 * (w/c 22 Jun → 20 Jul) — stable, properly dated, and therefore chaseable. The referring-adviser flag
 * on those cases is noise (6 / 3 / 3 / 3 / 1), so it cannot narrow this to genuine referrals.
 *
 * Hence: count protection cases OPENED and label the tile "Protection Opportunities", so nobody reads
 * it as the old measure or as a true referral.
 *
 * ⚠ TARGET NEEDS RESETTING. The 5/day, 25/week figure was set against the old (wrong) number.
 * Opportunities run ~48/week — roughly 2× it. Awaiting Kyle's ruling on the definition and target;
 * until then the board will show this comfortably ahead of a target that no longer means anything.
 * Note separately that protection cases WRITTEN ran 4 in W30 and 52 in July against the same 25/week
 * target — a real gap the old referral number was masking.
 */
export const PROTECTION_OPPORTUNITY_NOTE = "protectioncase.CreatedDate — see docstring" as const;

/**
 * WHAT COUNTS AS A LEAD — a NEW CLIENT, not a new case (Capricorn, 2026-08-17).
 *
 * Their ruling, prompted by the board reading 378 leads for Sat 8 – Wed 12 Aug against 291 on the
 * in-platform report the team ran at 17:00 on the 12th: "a new lead is actually a new client added to
 * the system". Cases opened against a client already on the books — remortgages above all — are real
 * work and still tracked, but they are not lead flow. Hence two KPIs: `leads` (new clients) and
 * `existingCases` (cases against existing clients).
 *
 * WHY WE DO NOT KEY ON THE PLATFORM'S OWN FIELD. Their report is `usp_LeadsReport` →
 * `usp_GetLeadsByUserId_LeadFlow` (Occfinance.Database), and that SP's header states its basis
 * outright: *"Date filtering is on `tblClient.AddDate` [rather than `tblLead.Created`]"*. So it dates
 * a lead by when the CLIENT record was created, which is exactly Capricorn's definition — any lead
 * for a pre-existing client has no AddDate in the window and never appears. Two further filters
 * narrow it again: the lead must have a live product of the requested FinanceTypeId
 * (`EXISTS tblfinance … IsDeleted = 0 AND IsExternalProduct = 0`), and results are scoped to the
 * brokers visible to whoever ran it (`#UserFilterIds` INNER JOINed on `tblLead.Adviser`) — which is
 * why their figure is also entity-scoped where the board is group-wide. It dedupes to one row per
 * client (`DENSE_RANK() … rn = 1`); we match that with COUNT(DISTINCT PrimaryClientKey).
 *
 * ⚠ `tblClient.AddDate` REACHES US UNUSABLE, which is why the basis below is derived instead.
 * In the share it is `client.AddedToSystemDate`, and measured 2026-08-17:
 *
 *   225,246 client rows       bulk-loaded 22 Apr 2026, populated, latest value 21 Apr 2026
 *   128,850 client rows       arrived 8 Jul 2026 onward — AddedToSystemDate NULL on every one
 *   of Sat 8 – Wed 12's leads: 335 clients NULL, 43 populated and all 43 predating the window
 *
 * So the literal field cannot date a single recent lead. Getting it populated on incremental loads is
 * the ask that would let us key on it exactly; until then this is the faithful equivalent.
 *
 * THE BASIS: a client is NEW on the date of their FIRST EVER case, across mortgage, protection and
 * general insurance (Capricorn's ruling on the ambiguous case: a client who arrived via protection is
 * not a new lead when they later take a mortgage). History runs to 2009 in `mortgagecase`, so
 * first-appearance is well-founded rather than an artifact of how far back the share goes.
 *
 * Client identity is `mortgagecase.PrimaryClientKey`, verified 2026-08-17: never NULL across all
 * 270,001 live Capricorn mortgage cases, agreeing with `mortgagecaseclient` on all 386 rows of the
 * reference week, and resolving 100% into `dbo.client`. The bridge tables supply the key for
 * protection and GI, which carry no direct column.
 *
 * Reference figures on this basis (measured 2026-08-17, migration batch excluded):
 *
 *   window                        cases   new clients   existing-client cases
 *   Sat  8 – Wed 12 Aug             377           315                      61
 *   Sat  8 – Fri 14 Aug (full)      575           463                     111
 *   Sat  1 – Fri  7 Aug             676           531                     145
 *   Sat 25 – Fri 31 Jul             538           456                      82
 *
 * The two legs partition the case count exactly — new-client CASES plus existing-client cases equals
 * the total; the published new-client figure is then deduped to clients, so it can sit one or two
 * below its own leg (315 clients from 316 cases in the reference week).
 *
 * ⚠ THE LEADS TARGET IS NOW ON THE WRONG BASIS. 633/week was set by headcount (Kyle 2026-07-14,
 * ~10 leads/adviser/wk) against the OLD, wider count. On the new definition the same week reads ~16%
 * lower, so every screen will show the firm further behind a target that was never set against this
 * measure. Awaiting Kyle's ruling; flagged on-screen until then. `existingCases` ships with NO target
 * for the same reason — Capricorn have not set one.
 */
export const NEW_CLIENT_LEAD_BASIS = "first case across mortgage/protection/GI — see docstring" as const;
