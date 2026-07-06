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
  if (ratio < 0.6) return "critical";
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

/** Today's date (YYYY-MM-DD) in `tz` — the business day the board measures. */
export function tzToday(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // en-CA → ISO-ish
}
