// Plain-English glossary of every dashboard figure — admin-only (same isTargetsAdmin gate as the
// Targets tab; see App.tsx's PAGES filter). Reference material, not live data, so this is the one
// page that doesn't call usePayload at all — it just reads static copy.

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
  { name: '"Data as of"', def: "The lake rebuilds overnight, once a day. Every screen stamps the most recent day it actually has data for — if it says \"7 Jul\", that's the freshest complete day the board knows about, even if today is the 8th." },
  { name: "The reporting week runs Sat → Fri", def: "This matches Capricorn's own convention for weekly reporting, not the calendar's Monday start. \"This week\" on every screen means the Saturday just gone through the coming Friday." },
  { name: "Placeholder targets", def: "Until Capricorn's own weekly targets are uploaded (via the Targets page), every target shown is a stand-in: each office's trailing 4-week average, stretched by 10%. It's there so the board isn't blank, not because it's the real number." },
  { name: "Weekly Written (Revenue)", def: "Market Momentum's \"Written\" is written COMMISSION only — mortgage commission plus protection commission. Client fees are NOT included (they were until 28 Jul 2026, which quietly inflated it against Capricorn's own Total Written report, a commission report). \"Est. Revenue\" on the Adviser League is the wider figure: commission plus client fees. \"Total Lending\" (loan value) is a third, separate figure — not the same as written.", note: "does not yet reconcile — see below" },
  { name: "Which window is each screen showing?", def: "This is the single most common source of confusion, so: Daily Run Chase and Office Run Chase show the CURRENT week to date (plus the latest trading day). Adviser League shows the current week to date. Funnel Health shows the current month to date. Market Momentum shows the LAST COMPLETE week. Every headline tile now prints its own dates, so you never have to remember which is which." },
  { name: "Provisional weeks", def: "A week that has just ended may not be final. On the date basis used up to 29 Jul 2026, cases were entered an average of six days after the date they were written, and W30 grew 12% in a single day after it closed. The corrected basis keys on a workflow status change recorded as it happens, which should be far more stable — but we have not yet watched it across a fortnight to prove that, so weeks within 14 days of their end are still marked \"provisional\" as a precaution. Leads and referrals are unaffected either way; those land the same day.", note: "precaution — being confirmed" },
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
  { name: "Leads", def: "A new enquiry entering the pipeline — the first step before anything else.", calc: "Counted the day the lead was created. One row per lead." },
  { name: "Mortgages Written", def: "A mortgage written — see the lifecycle above. Called \"Applications\" until 28 Jul 2026, which was misleading: it counts business WRITTEN, not applications submitted to a lender. \"Written\" means formally submitted for processing, not completed: it hasn't necessarily been approved or funded, and can still fall through. If one client takes out two products at once, that's two — products written, not people.", calc: "Counted the day the mortgage was written, per finance product (not per lead). Cases marked \"not proceeding\" are currently still included in this count." },
  { name: "Protection Opportunities", def: "A protection case opened — a protection opportunity started for a client. Called \"Protection Referrals\" until 30 Jul 2026, when a full review found the old figure was counting PaymentShield home-insurance quote attempts and currency-exchange referrals, not protection at all. Capricorn does not record a protection referral as an event anywhere (their advisers don't use the platform's assign-an-insurance-adviser step), so opportunities opened is the closest real measure.", calc: "Counted the day the protection case was created.", note: "target needs resetting" },
  { name: "Protection Sales", def: "A protection policy actually sold, following on from a referral.", calc: "Counted the day the protection case was written." },
  { name: "Day Target / Week Target", def: "Day Target is today's slice of the weekly number, using the weighted split above (Friday's is a little lower than Monday's). Week Target is the plain weekly figure." },
  { name: "Total Lending", def: "The total loan value of mortgages written this week — pounds of lending, NOT commission and NOT the \"Written\"/Revenue figure (which is commission). Useful for average loan size.", calc: "Sum of mortgage loan value on applications written this reporting week." },
  { name: "This Week strip", def: "Shows where the team should be by the end of each working day this week, and how far through the week we actually are." },
  { name: "Week Chase charts", def: "Three lines per KPI: dashed grey = expected pace, solid = actual so far, dotted = projected finish if the current pace holds." },
  { name: "Office Leaderboard", def: "Every office ranked by leads this week, with a status pill showing how each is tracking against its own target." },
];

const OFFICES_TERMS: Term[] = [
  { name: "% of Pace", def: "How an office's actual results compare to what's expected by this point in the week, averaged across all four KPIs and shown as one percentage. 100% means exactly on target for this point in the week.", calc: "Average of (actual ÷ expected-so-far) across the 4 KPIs, ×100." },
  { name: "Card order vs ranking", def: "The cards sit in a fixed office order (so the wall screen doesn't reshuffle every refresh) — but the numbered badge and the bottom ranking strip do reflect true performance rank." },
];

const ADVISERS: Term[] = [
  { name: "Est. Revenue", def: "An estimate of what the period earned, added up across every adviser: written commission PLUS client fees. Deliberately a wider measure than Market Momentum's \"Weekly Written\" (commission only) — and over a different window (this week to date, versus the last complete week). The tile shows the commission and fee parts separately, so the difference between the two screens is visible rather than mysterious.", calc: "Sum of (commission + client fee) on business written in the window printed on the tile.", note: "indicative — does not reconcile yet" },
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
  { name: "The six trend measures", def: "Mortgages Written, Protection Opportunities, Weekly Written, Lead Volume, Avg Case Size, and Protection Attach Rate (against a 30% target) — each charted week by week over 13 weeks." },
  { name: '"est." marker', def: "For four of the six measures, the current in-progress week is scaled up as if the rest of the week continues at the same pace, marked \"est.\" and left out of week-over-week comparisons — so a genuinely slow Monday doesn't read as a real decline." },
  { name: "Weekly Revenue forecast", def: "The solid line stops at the last fully-complete week — no guessing dressed up as fact. The current week shows a dashed forecast built day by day from what a typical Monday, Tuesday, etc. have looked like historically. As each real day lands, the forecast firms up.", note: "different from the other five" },
  { name: "vs Qtr Avg", def: "How the latest complete week compares to the average of the last ~13 weeks — the \"is this normal or unusual\" check." },
  { name: "Verdict bar", def: "A one-line read of the whole screen: momentum building, softening, or holding steady, based on whether most of the six measures are ahead of or behind their own quarter average." },
];

const TARGETS_TERMS: Term[] = [
  { name: "Current Targets", def: "Shows exactly what's driving every target figure across the dashboard right now, per office, plus who uploaded it and when — or a note that it's still the placeholder scaling if nobody's uploaded anything yet." },
  { name: "Uploading new targets", def: "An authorised admin downloads a blank template, fills in each office's weekly figures plus the business-wide weekly revenue target, and uploads it. It takes effect immediately across every screen. Anything that looks off (a missing office, a number that's jumped 5× overnight) is flagged before or after upload rather than silently accepted." },
];

export function Glossary(_props: PageProps) {
  return (
    <div className="screen">
      <div className="card">
        <div className="card-title"><span>Dashboard Glossary</span></div>
        <div className="placeholder-note">
          Plain-English definitions for every figure on the dashboard, plus how each is calculated underneath. Visible to Targets admins only.
        </div>
      </div>

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
