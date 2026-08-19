// Payload types for the datasets (mirrors src/services/reporting/datasets.ts on the server).

// `leads` counts NEW CLIENTS, not cases (Capricorn 2026-08-17); `existingCases` is the remortgage /
// repeat-client half that used to be folded into it. See NEW_CLIENT_LEAD_BASIS on the server.
export type KpiKey = "leads" | "applications" | "referrals" | "sales" | "existingCases";
export type PaceStatus = "ahead" | "on_pace" | "behind";
export type ChaseStatus = "ahead" | "on_pace" | "behind" | "critical";

/** Figures an upload can carry. `written` is the Revenue target (£, business-wide), not a per-office
 *  KPI — so this is deliberately not `KpiKey`. */
export type CapturedTarget = "leads" | "applications" | "referrals" | "sales" | "written";

export interface TargetsProvenance {
  source: "placeholder" | "upload";
  effectiveWeek: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  note?: string;
  /** Per-figure: true = Capricorn's own uploaded number, false = still our placeholder. `null` on an
   *  upload made before this was recorded. See TargetsProvenance on the server for why this exists. */
  captured: Record<CapturedTarget, boolean> | null;
  /** KPIs whose target is NOT from the upload but still one of our derived stand-ins. Leads is the
   *  standing case — no import route supplies it — so "source: upload" must never be read as "every
   *  figure here is Capricorn's". See TargetsProvenance on the server. */
  unconfirmed?: KpiKey[];
}

export interface Meta {
  offices: Array<{ name: string; color: string }>;
  targets: {
    daily: Record<KpiKey, number>;
    weekly: Record<KpiKey, number>;
    officeDaily: Record<string, Record<KpiKey, number>>;
    /** WEEKLY written targets, £ — Mortgage + Insurance (the dashboard's "Revenue"). */
    writtenWeekly: { mortgage: number; insurance: number };
  };
  targetsProvenance: TargetsProvenance;
  /** True only for the signed-in viewer's own request (never on the kiosk) — gates the
   *  Targets/Glossary nav tabs on the frontend. The upload route enforces the same check
   *  server-side regardless of what the nav shows. */
  isTargetsAdmin: boolean;
  dataAsOf: string;
  /** ISO wall-clock of the lake's last load. The share reloads 5× daily (~07:50/11:10/14:15/17:10/
   *  20:10), NOT overnight — the header shows this so "is it live?" is answerable at a glance. */
  lastRefreshAt: string | null;
  refreshCadence: string;
  /** Closed weeks whose figures have moved unexpectedly — drives the header warning everywhere. */
  revisedWeeks: number;
  refreshSeconds: number;
  cycleSeconds: number;
  pacingMode: "mtd" | "drip";
  timeZone: string;
}

export interface Pace {
  target: number;
  current: number;
  expectedByNow: number;
  aheadBehind: number;
  projectedFinish: number;
  status: PaceStatus;
}

export interface ChaseChart {
  days: string[];
  actual: Array<number | null>;
  /** Both null for an untargeted KPI: a flat zero pace line would read as a target of nothing, and a
   *  projection only means something measured against one. */
  targetPace: number[] | null;
  projection: Array<number | null> | null;
}

/** One office's against-target read for one KPI. `gap`/`pct` go null together when there is no
 *  target, or when less than one whole unit is due so far — a percentage against 0.14 expected is
 *  noise, not a verdict. */
export interface OfficePace {
  target: number;
  expected: number;
  gap: number | null;
  pct: number | null;
}

export interface WeekProgress {
  actualPct: number | null;
  expectedPct: number | null;
  /** +ahead / −behind, percentage points of the weekly target. */
  gapPp: number | null;
}

export interface DayView {
  date: string;
  actual: number;
  /** Null for an UNTARGETED KPI (see `targeted`) — there is no target, gap or verdict to show. */
  target: number | null;
  gap: number | null;
  status: ChaseStatus | null;
}

export interface DailyRunChasePayload {
  dataAsOf: string;
  /** Total mortgage value written this chase week (SUM(MortgageValue)) — not commission revenue. */
  /** TODAY's part-day counts, held apart from the chase so pace maths stays on complete days.
   *  Null at weekends. `loadedAt` is the load that produced them — the share reloads 5× daily. */
  today: { date: string; loadedAt: string | null; counts: Record<KpiKey, number> } | null;
  week: {
    start: string;
    end: string;
    days: string[];
    /** Cumulative expected share by end of each of the SEVEN days, Sat..Fri (%). Blended across the
     *  four KPIs — each card paces on its own curve, because Saturday is ~6% of a week's leads but
     *  ~1.5% of its written business. */
    cumulativeSharesPct: number[];
    /** Day labels for `days`, i.e. ["Sat","Sun","Mon",…,"Fri"]. */
    dayNames: string[];
    fraction: number;
    expectedPct: number;
    /** Blended ACTUAL attainment across the targeted KPIs. "Expected so far" is by construction the
     *  cumulative share at dataAsOf — the label under the last filled day — so it needs a real actual
     *  beside it or the pair says nothing (Capricorn 2026-08-18). Null before any week is measurable. */
    actualPct: number | null;
    /** +ahead / −behind, percentage points of the weekly target, blended. */
    gapPp: number | null;
    nowLabel: string;
    /** Most recent day with data — can now be a Saturday. */
    latestDay: string;
    /** True when the current week has no loaded data yet (early Monday). */
    pending: boolean;
  };
  kpis: Array<{
    key: KpiKey;
    label: string;
    /** False = tracked but not chased (no target set). The card shows the figure and its trend with
     *  NO ahead/behind verdict — without this an untargeted KPI paces against zero, which every
     *  status helper reads as "ahead". */
    targeted: boolean;
    weeklyTarget: number;
    wtd: number;
    pace: Pace | null;
    day: DayView;
    weekProgress: WeekProgress;
    chart: ChaseChart;
  }>;
  leaderboard: Array<{
    office: string;
    color: string;
    leads: number;
    applications: number;
    referrals: number;
    sales: number;
    existingCases: number;
    latest: Record<KpiKey, number>;
    /** Against-target read per KPI. Every KPI Capricorn uploads a target for carries one; the
     *  untargeted ones come back with null gap/pct and render no indicator. */
    paceByKpi: Record<KpiKey, OfficePace>;
    pct: number | null;
    status: ChaseStatus;
    hasTargets: boolean;
  }>;
  /** Column totals, so the table ties to each card's "Week to date" stat on its own face. */
  leaderboardTotals: Record<KpiKey, number>;
}

export interface OfficeRunChasePayload {
  dataAsOf: string;
  week: { nowLabel: string; start: string; end: string; expectedPct: number; pending: boolean };
  offices: Array<{
    office: string;
    color: string;
    hasTargets: boolean;
    active: boolean;
    kpis: Array<{
      key: KpiKey;
      label: string;
      actual: number;
      target: number;
      expected: number;
      gap: number;
      status: ChaseStatus;
    }>;
    pct: number | null;
    status: ChaseStatus;
    chart: { days: string[]; actualPct: Array<number | null>; targetPct: number[] };
    rank: number | null;
    /** Present on "Unassigned" only: the advisers with no office on file, busiest first. Naming them
     *  makes the row self-explaining instead of a mystery number (Kyle 2026-08-06). */
    members?: Array<{ name: string; leads: number }>;
  }>;
  champion: string | null;
}

export interface AdviserLeaguePayload {
  window: { from: string; to: string; weekdays: number; weeks: number };
  totals: {
    applications: number;
    referrals: number;
    sales: number;
    /** Commission + client fees — deliberately wider than Momentum's "Weekly Written" (commission
     *  only). Both parts are returned so the difference is explicit. */
    revenue: number;
    /** Mortgage + protection commission. */
    commission: number;
    /** Procuration fee on mortgage cases written in the window. */
    mortgageWritten: number;
    /** Commission on protection cases submitted in the window. */
    protectionWritten: number;
    /** The CLIENT fee — advice/arrangement fee charged to the client. Not solicitor or misc fees. */
    clientFees: number;
    avgConversion: number | null;
  };
  top: Array<{
    name: string;
    office: string;
    apps: number;
    refs: number;
    sales: number;
    avgPerDay: number | null;
    trend: number[];
    trendDir: "up" | "flat" | "down";
  }>;
  boards: LeagueBoards;
  improved: Array<{
    name: string;
    office: string;
    thisApps: number;
    thisRefs: number;
    lastApps: number;
    lastRefs: number;
    deltaPct: number | null;
  }>;
  focus: Array<{
    name: string;
    office: string;
    apps: number;
    refs: number;
    note: string;
    trendDir: "up" | "flat" | "down";
  }>;
}

export interface BoardRow {
  rank: number;
  name: string;
  office: string;
  /** Headline count for this board. */
  value: number;
  written: number;
  /** Protection sales introduced by this adviser's clients (derived — see referrals.ts). */
  referred: number;
  /** Protection sales this adviser wrote themselves. */
  sold: number;
  /** referred / written as a percentage; null when they wrote no mortgages. */
  rate: number | null;
  commission: number;
  /** Who converted this adviser's referrals, busiest first. */
  partners: Array<{ name: string; n: number }>;
}

export interface LeagueBoards {
  window: { from: string; to: string; weeks: number };
  /** How many protection sales could be tied back to an introducing adviser. */
  attribution: { attributed: number; unattributed: number; pct: number | null };
  written: BoardRow[];
  referred: BoardRow[];
  sold: BoardRow[];
}

export interface FunnelHealthPayload {
  dataAsOf: string;
  window: { from: string; to: string };
  stages: Array<{ key: string; label: string; count: number }>;
  conversions: Array<{ from: string; to: string; pct: number }>;
  /** Cases opened in the same window for clients already on the books — remortgages above all.
   *  NOT a funnel stage: it enters part-way along, so folding it into the leads stage would inflate
   *  every conversion below it. Shown as context beside the funnel. */
  existingCases: number;
  applicationsReferralsGap: { weeks: string[]; applications: number[]; referrals: number[] };
}

export interface MomentumKpi {
  key: string;
  label: string;
  fmt: "int" | "gbp" | "gbpk";
  latest: number | null;
  weekLabel: string;
  /** The tile's ACTUAL window (inclusive, Sat–Fri). Rendered on the tile: the tiles report the last
   *  COMPLETE week while the run-chase screens report the current one, and a bare "W30" gave no way
   *  to tell them apart (Kyle 2026-07-28). */
  weekFrom: string;
  weekTo: string;
  priorWeekLabel: string | null;
  /** True when this week's WrittenDate-keyed figure is still filling from input lag — mean 6 days,
   *  so a just-closed week is not final. */
  provisional: boolean;
  delta: number | null;
  deltaPct: number | null;
  vsQuarterPct: number | null;
  /** True when `latest` is the CURRENT week to date and `delta` compares it with the prior week
   *  truncated to the same weekday — the comparison Kyle asked for on 2026-08-07, made fair. */
  likeForLike: boolean;
  /** Last day included on BOTH sides of the comparison. */
  throughDay: string;
  /** The last COMPLETE week, kept alongside so a whole-week figure is always on hand. Null once the
   *  current week has itself closed. */
  lastFullWeek: { weekLabel: string; weekFrom: string; weekTo: string; value: number | null } | null;
  /** Set only Sat–Mon, while the current week holds nothing but weekend days and is therefore NOT
   *  the headline: its figure so far, shown small underneath. */
  currentWeekSoFar: { weekLabel: string; value: number | null; throughDay: string } | null;
}

export interface MarketMomentumPayload {
  dataAsOf: string;
  weeks: string[];
  partialLastWeek: boolean;
  /** True Sat–Mon: the current week is weekend-only, so tiles lead with the last complete week. */
  currentWeekTooEarly: boolean;
  series: {
    applications: number[];
    referrals: number[];
    /** Actual weekly WRITTEN business £k (Mortgage + Insurance) — stops (null) at the current,
     *  still-in-progress week. */
    writtenActualK: Array<number | null>;
    /** Null except a two-point segment: [last complete week's actual, current week's day-by-day
     *  forecast] — renders as a dashed "chipping away" projection from the actual line's end. */
    writtenForecastK: Array<number | null>;
    leads: number[];
    avgCaseSizeK: Array<number | null>;
    referralRatePct: Array<number | null>;
  };
  /** Written business vs target for the latest COMPLETE week (£), split by product + combined.
   *  "Written" is COMMISSION; `clientFees` is carried alongside, never folded in. */
  written: {
    weekLabel: string;
    weekFrom: string;
    weekTo: string;
    mortgage: { actual: number; target: number };
    insurance: { actual: number; target: number };
    combined: { actual: number; target: number };
    clientFees: number;
    provisional: boolean;
  };
  /** Top 10 commission earners for the SAME week `written` reports — the league beside the graph.
   *  All commission, product lines added together and never split (2026-08-19). */
  league: {
    weekLabel: string;
    weekFrom: string;
    weekTo: string;
    rows: Array<{ rank: number; name: string; commission: number; cases: number }>;
    /** Whole-firm written commission for the week — the value the graph plots for it. */
    total: number;
    /** Everyone who earned commission in the week, so "top 10" states what it is the top 10 of. */
    earners: number;
    /** Commission on cases with no adviser on file: inside `total`, absent from `rows`. */
    unattributed: number;
    provisional: boolean;
  };
  /** Combined weekly written target, £k — reference line on the Weekly Written trend. */
  writtenTargetCombinedK: number;
  kpis: MomentumKpi[];
  referralRateTargetPct: number;
  verdict: string;
}

export interface FeedItem {
  kind: "application" | "lead" | "referral" | "sale" | "milestone";
  icon: string;
  text: string;
  accent: "none" | "green" | "gold";
}

export interface LiveFeedPayload {
  dataAsOf: string;
  dayLabel: string;
  items: FeedItem[];
}

// --------------------------------------------------------------- definitions

/** Confidence the board is claiming for a figure — rendered as a badge wherever it appears. */
export type MetricStatus = "agreed" | "indicative" | "open";

/** One metric's single agreed definition. Mirrors src/domain/metrics.ts, which is the only place a
 *  definition is written down (Conor 2026-08-04: one definition per KPI, clickable from the tile). */
export interface MetricDefinition {
  key: string;
  label: string;
  definition: string;
  calculation: string;
  source: string;
  reconcilesTo: string | null;
  owner: string;
  frequency: string;
  status: MetricStatus;
  note?: string;
}

export interface DefinitionsPayload {
  cadence: { summary: string; asOfRule: string; refresh: string };
  metrics: MetricDefinition[];
}

// --- Screen 6: Reconciliation -------------------------------------------------

export interface WeekFigures {
  mortgageCommission: number;
  mortgageCases: number;
  protectionCommission: number;
  protectionCases: number;
  clientFees: number;
}

export type RevisionSeverity = "none" | "settling" | "revised" | "reduced";

export interface WeekObservation {
  observedAt: string;
  lakeLoadedAt: string | null;
  group: WeekFigures;
}

export interface WeekRevision {
  weekStart: string;
  weekEnd: string;
  severity: RevisionSeverity;
  first: WeekObservation;
  latest: WeekObservation;
  deltas: WeekFigures;
  changes: number;
  observedFrom: string;
  lastChangedAt: string | null;
  changedAfterSettle: boolean;
  settleThrough: string;
}

export interface BasisNote {
  label: string;
  rule: string;
  source: string | null;
}

export interface ReconciliationPayload {
  dataAsOf: string;
  lakeLoadedAt: string | null;
  snapshotsEnabled: boolean;
  week: { start: string; end: string; label: string; settleThrough: string; provisional: boolean };
  /** OrganisationKey Capricorn reconciles against (CFM) — that row leads the table. */
  reconcilesToEntity: number;
  weeks: Array<{
    start: string;
    end: string;
    label: string;
    severity: RevisionSeverity;
    changes: number;
    observed: boolean;
  }>;
  live: {
    observedAt: string;
    group: WeekFigures;
    byOrg: Array<{ key: number; name: string; shortName: string; figures: WeekFigures | null }>;
  } | null;
  revision: WeekRevision | null;
  history: WeekObservation[];
  alerts: Array<{
    weekStart: string;
    weekEnd: string;
    label: string;
    severity: RevisionSeverity;
    deltas: WeekFigures;
    lastChangedAt: string | null;
  }>;
  basis: { mortgage: BasisNote; protection: BasisNote; clientFees: BasisNote; scope: BasisNote };
}
