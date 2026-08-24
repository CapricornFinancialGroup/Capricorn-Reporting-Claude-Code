// Pure run-chase pace math (no DB) — extracted from the Smartr CS Growth OS run-rate module.
// Every screen's ahead/behind story flows through computePace + chaseStatus so they always agree.

export type PaceStatus = "ahead" | "on_pace" | "behind";

/** Green/amber/red banding: >5% over expected = ahead, >5% under = behind, else on pace. */
export function paceStatus(current: number, expected: number): PaceStatus {
  if (expected <= 0) return current > 0 ? "ahead" : "on_pace";
  const ratio = current / expected;
  if (ratio >= 1.05) return "ahead";
  if (ratio <= 0.95) return "behind";
  return "on_pace";
}

export type ChaseStatus = "ahead" | "on_pace" | "behind" | "critical";

/** Four-tier leaderboard banding vs expected-by-now: ≥100% ahead, ≥90% on pace, <60% critical. */
export function chaseStatus(current: number, expected: number): ChaseStatus {
  if (expected <= 0) return current > 0 ? "ahead" : "on_pace";
  const ratio = current / expected;
  if (ratio >= 1) return "ahead";
  if (ratio >= 0.9) return "on_pace";
  // CRITICAL ALSO HAS TO BE MORE THAN A COUPLE OF CASES SHORT, not just a low ratio.
  //
  // On a small expectation the ratio bands stop being a scale. At expected = 1 the only reachable
  // outcomes are ratio 0 and ratio 1 — critical or ahead, with no "behind" in between — so one case
  // decides between the board's loudest word and its best one. On 2026-08-24 that put two CRITICALs on
  // the wall for a Saturday with 0 protection referrals against a target of 1, sitting next to leads
  // and mortgages both +6 ahead.
  //
  // Stated as a SHORTFALL rather than a floor on `expected`, because that is the thing that actually
  // matters and it scales by itself: you are in crisis when you are at least two whole cases short AND
  // below 60%. One-and-a-half cases short of two is not a crisis; twenty of a hundred is. The miss is
  // still reported — it reads "behind", with the figures printed beside it — it just stops shouting.
  if (ratio < 0.6 && expected - current >= 2) return "critical";
  return "behind";
}

export interface Pace {
  target: number;
  current: number;
  expectedByNow: number;
  aheadBehind: number;
  projectedFinish: number;
  status: PaceStatus;
}

/** The run-chase block for one metric: target vs current at `fraction` (0..1) through the period. */
export function computePace(target: number, current: number, fraction: number): Pace {
  const expectedByNow = target * fraction;
  // Before the period opens (fraction 0) extrapolation is undefined — fall back to the target.
  const projectedFinish = fraction > 0 ? Math.round(current / fraction) : Math.round(target);
  return {
    target: Math.round(target),
    current,
    expectedByNow: Math.round(expectedByNow),
    aheadBehind: Math.round(current - expectedByNow),
    projectedFinish,
    status: paceStatus(current, expectedByNow),
  };
}

/**
 * Pace for a week that includes a PART day — the card's headline verdict.
 *
 * `computePace` needs a clean "how far through the period are we" fraction, and a week that is two
 * whole days plus a third of a third day has no such fraction on the day curve. So the expectation is
 * assembled instead: every complete day's target in full, plus the share of today the data share has
 * actually copied (`dayRecordedShare`). Comparing today's part-day against its WHOLE-day target is the
 * 2026-07-30 false collapse — the board reads behind all morning and recovers by evening.
 *
 * `todayTarget` must be TODAY's day target. Passing the judged day's — Saturday's, on a Monday — is
 * the bug this replaced: Saturday carries ~6% of a week's leads against a Monday's ~19%, so the board
 * compared 62 leads with 13 and announced "+49 ahead" where the truth was "+21".
 *
 * The identity that matters, and what the test pins: this verdict equals the complete-days verdict
 * plus today's own. A card whose three figures do not add up is a card people stop believing
 * (Capricorn, 2026-08-24).
 */
export function paceInclPartDay(
  weeklyTarget: number,
  achievedComplete: number,
  expectedThroughComplete: number,
  todayCount: number,
  todayTarget: number,
  recordedShare: number,
): Pace {
  const expected = expectedThroughComplete + todayTarget * recordedShare;
  const fraction = weeklyTarget > 0 ? expected / weeklyTarget : 0;
  return computePace(weeklyTarget, achievedComplete + todayCount, fraction);
}

/** Today's date (YYYY-MM-DD) in `tz` — the business day the board measures. */
export function tzToday(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // en-CA → ISO-ish
}

/** Hour-of-day (0–23) of an instant in the reporting timezone. Used to place a lake load on the
 *  intraday arrival curve (dayRecordedShare) — the load stamps are UTC and the curve is London, which
 *  is a one-hour error through BST and exactly the confusion the cadence copy caused. */
export function tzHour(at: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(at);
  return parseInt(h, 10);
}
