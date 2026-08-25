// Plain-English glossary of every dashboard figure — admin-only (same isTargetsAdmin gate as the
// Targets tab; see App.tsx's PAGES filter). Reference material, not live data, so this is the one
// page that doesn't call usePayload at all — it just reads static copy.

import { EMPTY_FILTERS, usePayload } from "../api.js";
import { MetricDetail, StatusBadge } from "../components/MetricInfo.js";
import type { DefinitionsPayload } from "../types.js";
import type { PageProps } from "./common.js";

interface Term {
  name: string;
  def: string;
  calc?: string;
  note?: string;
}

function TermRow({ t }: { t: Term }) {
  return (
    <div className="glossary-term">
      <div className="glossary-term-name">
        {t.name}
        {t.note && <span className="glossary-note">{t.note}</span>}
      </div>
      <div className="glossary-term-def">{t.def}</div>
      {t.calc && <div className="glossary-calc">{t.calc}</div>}
    </div>
  );
}

function Section({ title, sub, terms }: { title: string; sub?: string; terms: Term[] }) {
  return (
    <div className="card">
      <div className="card-title"><span>{title}</span></div>
      {sub && <div className="placeholder-note" style={{ marginBottom: 10 }}>{sub}</div>}
      <div className="glossary-list">
        {terms.map((t) => <TermRow key={t.name} t={t} />)}
      </div>
    </div>
  );
}

const CONCEPTS: Term[] = [
  { name: '"Data as of"', def: "Two different things, and this is the most-asked question on the board. \"Data as of\" is the most recent day treated as COMPLETE — which is why on a Friday it reads Thursday. It does not advance during the day, by design: a part-loaded day measured against a whole day's target would read as behind all morning and recover by evening. Today's figure is not hidden, it just sits separately as \"Today so far\" on each card, stamped with the load that produced it. Separately, the data share RELOADS four times a day, London time: roughly 06:00, 11:20, 14:50 and 17:35, drifting up to half an hour either side, and occasionally a load is missed. Nothing entered after the late-afternoon load reaches the board until the next morning, which is why a day only reads complete the following day. Between two loads the figures cannot change no matter how often the page is refreshed — so if \"Today so far\" looks stuck, check the load time in the header against that list.", note: "London times, measured 21–24 Aug 2026 — the schedule changed on 21 Aug" },
  { name: '"Today so far"', def: "The small figure at the foot of each KPI card on the Daily Run Chase: what has landed TODAY as at the last data load. It deliberately has no target next to it and no ahead/behind status, because today is a part-day: comparing four hours of activity against a whole day's target would show the firm drifting behind all morning and quietly recovering by evening. Every other number on the card measures complete days. It is hidden at weekends.", calc: "Same definition as the KPI above it, counted over today only, from the most recent load." },
  { name: "The reporting week runs Sat → Fri", def: "This matches Capricorn's own convention for weekly reporting, not the calendar's Monday start. \"This week\" on every screen means the Saturday just gone through the coming Friday." },
  { name: "Placeholder targets", def: "Until Capricorn's own weekly targets are uploaded (via the Targets page), every target shown is a stand-in: each office's trailing 4-week average, stretched by 10%. It's there so the board isn't blank, not because it's the real number." },
  { name: "Weekly Written (Revenue)", def: "Market Momentum's \"Written\" is written COMMISSION only — mortgage commission plus protection commission. Client fees are NOT included (they were until 28 Jul 2026, which quietly inflated it against Capricorn's own Total Written report, a commission report). \"Written Commission\" on the Adviser League is the same commission pair over a different window (this week to date, not the last complete week). \"Total Lending\" (loan value) is a third, separate figure — not the same as written.", note: "does not yet reconcile — see below" },
  { name: "Which window is each screen showing?", def: "This is the single most common source of confusion, so: Daily Run Chase and Office Run Chase show the CURRENT week to date (plus the latest trading day). Adviser League shows the current week to date. Funnel Health shows the current month to date. Market Momentum shows the LAST COMPLETE week. Every headline tile now prints its own dates, so you never have to remember which is which." },
  { name: "Provisional weeks", def: "A week that has just ended is not final. The Reconciliation screen marks the week you have selected \"provisional\" while it is within 14 days of its end; the other screens no longer carry the label, because there it could never switch off — they always show the current or most recent week, which is provisional by definition, and a permanent badge tells you nothing. This is now measured rather than assumed: every closed week watched since 10 Aug 2026 has moved after it closed, and the movement goes BOTH ways. Sat 1–7 Aug lost a mortgage case, £982 of mortgage commission and £1,586 of protection commission — 7.3% — because business already counted stopped being counted; Sat 25–31 Jul was still climbing on 19 Aug, nineteen days after it ended. So treat any just-closed week as accurate to within a few thousand pounds, not to the penny, and read the Reconciliation screen for the week's full history before quoting it. Leads and referrals are unaffected; those land the same day.", note: "confirmed by snapshot history" },
  { name: "What \"written\" means, precisely", def: "The same thing Capricorn's own Total Written Report means by it: the date a case reached \"Pre-offer Processing\". Until 29 Jul 2026 this dashboard used a different date field that sits 1–21 days earlier, which is why the board and that report disagreed — raised by Kyle on 28 Jul and now fixed. Weekly totals barely changed; what changed is which week a case counts in, so short windows moved a lot and full weeks moved little.", calc: "Mortgages: the Pre-offer Processing status date. Protection: its written date (the equivalent status is only recorded on a fifth of protection cases, so using it would lose most of them; the two agree where both exist)." },
  { name: "Protection credit by adviser", def: "Still being resolved. The Total Written Report credits protection to the lead's insurance adviser and can split one policy's commission between two advisers; the reporting data carries a single adviser per case. Firm-wide protection totals are close, but per-adviser protection figures on the Adviser League will not match that report yet.", note: "open" },
  { name: "Weighted daily pace", def: "A week's target isn't split evenly across 5 days. Monday–Thursday each carry a fifth (a bit over 20% each); Friday carries slightly less, since Friday afternoons tend to be quieter for the team." },
  { name: "Status colours", def: "Ahead / On pace / Behind / Critical recur everywhere a target is being chased. Critical means meaningfully behind, not just slightly off." },
];

const LIFECYCLE: Term[] = [
  { name: "1. Lead", calc: "LeadDate", def: "An enquiry lands — someone's interested, nothing's been submitted yet." },
  {
    name: "2. Written",
    calc: "WrittenDate",
    def: "The application is formally submitted for processing. This is what \"Applications\" and \"Total Written\" count — it does NOT mean the mortgage has completed, or even been approved. A written application can still fall through.",
  },
  { name: "3. Offer issued", calc: "Post-offer Processing status date", def: "The lender has come back with a formal mortgage offer. One step past written, still not the finish line. Until 30 Jul 2026 this used a field that is empty on 97% of cases, so Funnel Health showed roughly an eighth of the real offers — it now uses the same status the platform's own reports use." },
  { name: "4. Completion", calc: "CompletionDate", def: "The mortgage actually completes and funds. Not shown as its own tile today, but it's what \"still open\" means behind the scenes — a case that's been written but hasn't completed and hasn't fallen through." },
];

const DAILY: Term[] = [
  { name: "New Client Leads", def: "A NEW CLIENT entering the pipeline — someone Capricorn has not dealt with before. Changed on 17 Aug 2026: a lead now means a new client, not a new case. Work opened for a client already on the books is counted separately as Existing Client Cases. This is why the board read 378 for 8–12 Aug against 291 on the in-platform report — that report dates a lead by when the CLIENT record was created, so it never sees a lead raised for an existing client.", calc: "Counted the day the lead was created, as distinct CLIENTS whose first ever case (mortgage, protection or general insurance) this is. One per client, not per product.", note: "target still on the old, wider basis" },
  { name: "Existing Client Cases", def: "A case opened for a client Capricorn already has — remortgages above all, plus repeat clients and second applications. Real work, and the other half of what used to be a single \"Leads\" number, but not new business won.", calc: "Counted the day the case was created, as CASES not clients: one client bringing two remortgages is two.", note: "no target set" },
  { name: "Mortgages Written", def: "A mortgage written — see the lifecycle above. Called \"Applications\" until 28 Jul 2026, which was misleading: it counts business WRITTEN, not applications submitted to a lender. \"Written\" means formally submitted for processing, not completed: it hasn't necessarily been approved or funded, and can still fall through. If one client takes out two products at once, that's two — products written, not people.", calc: "Counted the day the mortgage was written, per finance product (not per lead). Cases marked \"not proceeding\" are currently still included in this count." },
  { name: "Protection Referrals", def: "A protection case opened for a client. Read the name with care: despite the label this is not a count of referral EVENTS — Capricorn does not record a referral as an event anywhere (their advisers don't use the platform's assign-an-insurance-adviser step, which resolves on 3 of 1,839 cases), so cases opened is the closest real measure. The figure was corrected on 30 Jul 2026, when a review found the old one was counting PaymentShield home-insurance quote attempts and currency-exchange referrals, not protection at all; the tile was renamed \"Protection Opportunities\" to make that clear, and back to Capricorn's own wording on 17 Aug 2026 over the corrected figure.", calc: "Counted the day the protection case was created.", note: "target needs resetting" },
  { name: "Protection Sales", def: "A protection policy actually sold, following on from a referral.", calc: "Counted the day the protection case was written." },
  { name: "Day Target / Week Target", def: "Day Target is today's slice of the weekly number, using the weighted split above (Friday's is a little lower than Monday's). Week Target is the plain weekly figure." },
  { name: "vs Target (leaderboard)", def: "An office's new-client leads against the share of its weekly target due by now — the percentage, the expected figure, and the gap. A dash means that office has no leads target set, which is not the same as being at 0%.", calc: "Actual ÷ (weekly office target × the share of the week elapsed on the leads day-curve)." },
  { name: "Office Leaderboard window", def: "Week to date through the last COMPLETE day — today is deliberately excluded, because the table judges offices against target and a part-day measured against a whole-day target reads as behind all morning. The cards above headline TODAY, so the two will differ; the leaderboard's totals row equals each card's \"Week to date\" figure, which is the like-for-like comparison." },
  { name: "This Week strip", def: "Shows where the team should be by the end of each working day this week, and how far through the week we actually are." },
  { name: "Week Chase charts", def: "Three lines per KPI: dashed grey = expected pace, solid = actual so far, dotted = projected finish if the current pace holds." },
  { name: "Office Leaderboard", def: "Every office ranked by leads this week, with a status pill showing how each is tracking against its own target." },
];

const OFFICES_TERMS: Term[] = [
  { name: "% of Pace", def: "How an office's actual results compare to what's expected by this point in the week, averaged across all four KPIs and shown as one percentage. 100% means exactly on target for this point in the week.", calc: "Average of (actual ÷ expected-so-far) across the 4 KPIs, ×100." },
  { name: "Card order vs ranking", def: "The cards sit in a fixed office order (so the wall screen doesn't reshuffle every refresh) — but the numbered badge and the bottom ranking strip do reflect true performance rank." },
];

const ADVISERS: Term[] = [
  { name: "Written Commission", def: "Commission written in the period, added up across every adviser: mortgage commission plus protection commission — the same pair Capricorn's Total Written Report shows. Client fees are NOT included; they are shown beside the figure instead. Called \"Est. Revenue\" and computed as commission plus fees until 10 Aug 2026, when Kyle ruled the fee out: the written report does not capture it, so including it put this permanently above his figure. The window differs from Market Momentum's Weekly Written — this week to date, versus the last complete week.", calc: "Mortgage commission + protection commission on business written in the window printed on the tile. Client fees stated separately.", note: "reconciles to the Total Written Report" },
  { name: "Avg Conversion", def: "Total referrals ÷ total mortgages written, over the period.", calc: "Flagged internally as possibly not the exact ratio Conor has in mind — worth confirming, not just trusting the number.", note: "worth confirming with Conor" },
  { name: "Top Performers", def: "The advisers with the most mortgages written in the period, ranked highest first." },
  { name: "Most Improved", def: "Advisers whose combined mortgages written + referrals have grown the most vs the immediately preceding period. If the current week is still in progress, this compares a fair, pace-adjusted estimate rather than penalising Monday for not yet being Friday." },
  { name: "Focus This Month", def: "Advisers with unusually low written activity — a coaching nudge list, not a judgement. A note appears when referrals are strong even though applications are low, since that's a different (less concerning) pattern than being quiet across the board." },
];

const FUNNEL: Term[] = [
  { name: "Sales Pipeline funnel", def: "Leads → Mortgages Written → Offers → Referrals → Protection Sales. The percentage under each stage is that stage's share of total leads — NOT a conversion rate from the stage before it (offers naturally lag applications, so a same-window apps→offers ratio would look artificially low)." },
  { name: "Stage Metrics", def: "Volume at each stage this month, plus the average days cases have sat there without moving forward." },
  { name: "Active Alerts", def: "Protection Conversion Rate critical fires when fewer than half of protection referrals convert to sales. Applications Aged fires when applications have gone 7+ days without a lender offer." },
  { name: "Mortgages Written vs Referrals", def: "Two lines over recent weeks — mortgages written on top, referrals underneath. The shaded gap between them IS the unreferred opportunity: written business not yet passed to protection." },
  { name: "Cases Awaiting Action", def: "Call Now (leads a day+ old, nothing written yet), Follow Up (offers issued 7+ days ago, not completed), Chase Lender (applications written 7+ days ago, no lender offer), Refer Now (applications written this month, not yet referred to protection)." },
];

const MOMENTUM: Term[] = [
  { name: "The six trend measures", def: "Mortgages Written, Protection Referrals, Weekly Written, New Client Leads, Avg Case Size, and Protection Attach Rate (against a 30% target) — each charted week by week over 13 weeks." },
  { name: '"est." marker', def: "For four of the six measures, the current in-progress week is scaled up as if the rest of the week continues at the same pace, marked \"est.\" and left out of week-over-week comparisons — so a genuinely slow Monday doesn't read as a real decline." },
  { name: "Weekly Revenue forecast", def: "The solid line stops at the last fully-complete week — no guessing dressed up as fact. The current week shows a dashed forecast built day by day from what a typical Monday, Tuesday, etc. have looked like historically. As each real day lands, the forecast firms up.", note: "different from the other five" },
  { name: "vs Qtr Avg", def: "How the latest complete week compares to the average of the last ~13 weeks — the \"is this normal or unusual\" check." },
  { name: "Verdict bar", def: "A one-line read of the whole screen: momentum building, softening, or holding steady, based on whether most of the six measures are ahead of or behind their own quarter average." },
];

const TARGETS_TERMS: Term[] = [
  { name: "Current Targets", def: "Shows exactly what's driving every target figure across the dashboard right now, per office, plus who uploaded it and when — or a note that it's still the placeholder scaling if nobody's uploaded anything yet." },
  { name: "Uploading new targets", def: "An authorised admin downloads a blank template, fills in each office's weekly figures plus the business-wide weekly revenue target, and uploads it. It takes effect immediately across every screen. Anything that looks off (a missing office, a number that's jumped 5× overnight) is flagged before or after upload rather than silently accepted." },
];

/** THE dictionary — rendered from src/domain/metrics.ts, the same registry behind every tile's ⓘ.
 *  Hand-maintaining a second copy here is how definitions drift, which is what produced a fortnight
 *  of "why does this number differ?" email (Conor 2026-08-04). The prose sections below remain
 *  hand-written because they explain concepts, not metrics. */
function MetricDictionary({ mode }: { mode: PageProps["mode"] }) {
  const { data } = usePayload<DefinitionsPayload>("definitions", EMPTY_FILTERS, mode, 0);
  if (!data) return <div className="card"><div className="loading">Loading definitions…</div></div>;
  return (
    <>
      <div className="card">
        <div className="card-title"><span>Data Freshness</span></div>
        <div className="glossary-term-def">{data.cadence.summary}</div>
        <div className="glossary-calc" style={{ marginTop: 6 }}>{data.cadence.asOfRule}</div>
        <div className="glossary-calc">Refresh: {data.cadence.refresh}</div>
      </div>
      <div className="card">
        <div className="card-title">
          <span>Metric Dictionary</span>
          <span className="card-sub">the single agreed definition of every figure · same source as the ⓘ on each tile</span>
        </div>
        <div className="glossary-list">
          {data.metrics.map((m) => (
            <div className="glossary-term" key={m.key}>
              <div className="glossary-term-name">
                {m.label} <StatusBadge status={m.status} />
              </div>
              <MetricDetail m={m} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function Glossary({ mode }: PageProps) {
  return (
    <div className="screen">
      <div className="card">
        <div className="card-title"><span>Dashboard Glossary</span></div>
        <div className="placeholder-note">
          Every figure on the dashboard, with its single agreed definition, calculation, source, owner and
          frequency — the same content that opens from the ⓘ beside each tile, so the two can never
          disagree. Statuses are honest: <b>agreed</b> reconciles to Capricorn's own reporting,
          <b> indicative</b> has an open question against it, <b>definition open</b> means don't make
          decisions on it yet. Visible to Targets admins only.
        </div>
      </div>

      <MetricDictionary mode={mode} />

      <Section title="General Concepts" sub="A handful of ideas that apply across every screen." terms={CONCEPTS} />

      <Section
        title="The Application Lifecycle"
        sub={'Four terms — Lead, Written, Offer, Completion — recur across every screen, always in this order. A case can also be marked "Not Proceeding" at any point after being written (withdrawn/declined) — "Mortgages Written" still counts these today (a known open item); the Funnel Health work queues exclude anything Not Proceeding or already completed.'}
        terms={LIFECYCLE}
      />
      <div className="card">
        <div className="placeholder-note">
          <b>On "Written", precisely:</b> the exact trigger — what specific action in the advisers'
          case-management system sets this date — is defined by that system's own workflow, not by
          this dashboard. The dashboard only reads the date once it's set; it doesn't define or
          control when that happens.
        </div>
      </div>

      <Section title="Daily / Office Run Chase" terms={DAILY} />
      <Section title="Office Run Chase — additional terms" terms={OFFICES_TERMS} />
      <Section title="Adviser League" terms={ADVISERS} />
      <Section title="Funnel Health" terms={FUNNEL} />
      <Section title="Market Momentum" terms={MOMENTUM} />
      <Section title="Targets" terms={TARGETS_TERMS} />
    </div>
  );
}
