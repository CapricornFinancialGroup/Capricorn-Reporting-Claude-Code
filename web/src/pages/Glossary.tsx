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
  { name: '"Indicative" revenue figures', def: "Anywhere revenue is shown, it's built from whichever commission columns look right in the data — Capricorn hasn't yet confirmed the exact commission basis. Treat these as directionally correct, not final." },
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
  { name: "3. Offer issued", calc: "OfferIssueDate", def: "The lender has come back with a formal mortgage offer. One step past written, still not the finish line." },
  { name: "4. Completion", calc: "CompletionDate", def: "The mortgage actually completes and funds. Not shown as its own tile today, but it's what \"still open\" means behind the scenes — a case that's been written but hasn't completed and hasn't fallen through." },
];

const DAILY: Term[] = [
  { name: "Leads", def: "A new enquiry entering the pipeline — the first step before anything else.", calc: "Counted the day the lead was created. One row per lead." },
  { name: "Applications", def: "A mortgage application written — see the lifecycle above. \"Written\" means formally submitted, not completed: it hasn't necessarily been approved or funded, and can still fall through. If one client takes out two products at once, that's two applications — products written, not people.", calc: "Counted the day the application was written, per finance product (not per lead). Cases marked \"not proceeding\" are currently still included in this count." },
  { name: "Protection Referrals", def: "A client referred across to the protection (insurance) side of the business.", calc: "Counted the day the referral was created, excluding any the adviser declined or that errored. Not the same field as the mortgage system's own \"referred\" flag — that one has never actually been populated for Capricorn." },
  { name: "Protection Sales", def: "A protection policy actually sold, following on from a referral.", calc: "Counted the day the protection case was written." },
  { name: "Day Target / Week Target", def: "Day Target is today's slice of the weekly number, using the weighted split above (Friday's is a little lower than Monday's). Week Target is the plain weekly figure." },
  { name: "Total Written", def: "The total value of mortgages written this week — pounds of lending, not commission earned. Separate from Adviser League's \"Est. Revenue\", which is about commission.", calc: "Sum of mortgage value on applications written this reporting week." },
  { name: "This Week strip", def: "Shows where the team should be by the end of each working day this week, and how far through the week we actually are." },
  { name: "Week Chase charts", def: "Three lines per KPI: dashed grey = expected pace, solid = actual so far, dotted = projected finish if the current pace holds." },
  { name: "Office Leaderboard", def: "Every office ranked by leads this week, with a status pill showing how each is tracking against its own target." },
];

const OFFICES_TERMS: Term[] = [
  { name: "% of Pace", def: "How an office's actual results compare to what's expected by this point in the week, averaged across all four KPIs and shown as one percentage. 100% means exactly on target for this point in the week.", calc: "Average of (actual ÷ expected-so-far) across the 4 KPIs, ×100." },
  { name: "Card order vs ranking", def: "The cards sit in a fixed office order (so the wall screen doesn't reshuffle every refresh) — but the numbered badge and the bottom ranking strip do reflect true performance rank." },
];

const ADVISERS: Term[] = [
  { name: "Est. Revenue", def: "An estimate of commission earned in the period, added up across every adviser.", calc: "Sum of (commission + client fee) on business written in the window.", note: "indicative" },
  { name: "Avg Conversion", def: "Total referrals ÷ total applications, over the period.", calc: "Flagged internally as possibly not the exact ratio Conor has in mind — worth confirming, not just trusting the number.", note: "worth confirming with Conor" },
  { name: "Top Performers", def: "The advisers with the most applications written in the period, ranked highest first." },
  { name: "Most Improved", def: "Advisers whose combined applications + referrals have grown the most vs the immediately preceding period. If the current week is still in progress, this compares a fair, pace-adjusted estimate rather than penalising Monday for not yet being Friday." },
  { name: "Focus This Month", def: "Advisers with unusually low application activity — a coaching nudge list, not a judgement. A note appears when referrals are strong even though applications are low, since that's a different (less concerning) pattern than being quiet across the board." },
];

const FUNNEL: Term[] = [
  { name: "Sales Pipeline funnel", def: "Leads → Mortgage Apps → Offers → Referrals → Protection Sales. The percentage under each stage is that stage's share of total leads — NOT a conversion rate from the stage before it (offers naturally lag applications, so a same-window apps→offers ratio would look artificially low)." },
  { name: "Stage Metrics", def: "Volume at each stage this month, plus the average days cases have sat there without moving forward." },
  { name: "Active Alerts", def: "Protection Conversion Rate critical fires when fewer than half of protection referrals convert to sales. Applications Aged fires when applications have gone 7+ days without a lender offer." },
  { name: "Applications vs Referrals", def: "Two lines over recent weeks — applications on top, referrals underneath. The shaded gap between them IS the unreferred opportunity: applications not yet passed to protection." },
  { name: "Cases Awaiting Action", def: "Call Now (leads a day+ old, nothing written yet), Follow Up (offers issued 7+ days ago, not completed), Chase Lender (applications written 7+ days ago, no lender offer), Refer Now (applications written this month, not yet referred to protection)." },
];

const MOMENTUM: Term[] = [
  { name: "The six trend measures", def: "Mortgage Applications, Protection Referrals, Weekly Revenue, Lead Volume, Avg Case Size, and Protection Referral Rate (against a 30% target) — each charted week by week over 13 weeks." },
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
        sub={'Four terms — Lead, Written, Offer, Completion — recur across every screen, always in this order. A case can also be marked "Not Proceeding" at any point after being written (withdrawn/declined) — "Applications" still counts these today (a known open item); the Funnel Health work queues exclude anything Not Proceeding or already completed.'}
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
