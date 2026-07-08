// Trend / acceleration helpers — the CEO's "not where we are, whether we're accelerating" framing
// (+x% vs last week, +y% vs last month). Pure date + percentage math so it unit-tests without a DB;
// the routes call these to build the comparison windows they then query.

/** Percentage change current vs previous, as a fraction (0.2 = +20%). Null when previous is 0. */
export function pctDelta(current: number, previous: number): number | null {
  return previous ? (current - previous) / previous : null;
}

/** Shift an ISO date (YYYY-MM-DD) by whole days (UTC), returning ISO. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (UTC). */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Count of weekdays (Mon–Fri) in the inclusive range [fromIso, toIso] — the denominator for a rep's
 *  average DAILY pace over a rolling window (reps work weekdays, so weekends shouldn't dilute it). */
export function weekdaysBetween(fromIso: string, toIso: string): number {
  let count = 0;
  for (let d = fromIso; d <= toIso; d = shiftDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export interface DateWindow {
  from: string;
  to: string;
}

/** The Saturday–Friday week containing `iso` — Capricorn's own reporting-week convention
 *  (`docs/data-dictionary.md`), used everywhere "this week" is computed. Returns just the start
 *  date: every call site only ever needed the window's start, not its end. */
export function weekStartOf(iso: string): string {
  const back = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7; // 0 = Saturday
  return shiftDays(iso, -back);
}

/** The calendar month containing `iso`. */
export function monthOf(iso: string): DateWindow {
  const from = `${iso.slice(0, 7)}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0); // last day of the month
  return { from, to: d.toISOString().slice(0, 10) };
}

/** The window immediately before `w` of equal length (for like-for-like comparison). */
export function previousPeriod(w: DateWindow): DateWindow {
  const fromMs = new Date(`${w.from}T00:00:00Z`).getTime();
  const toMs = new Date(`${w.to}T00:00:00Z`).getTime();
  const lenDays = Math.round((toMs - fromMs) / 86_400_000) + 1;
  return { from: shiftDays(w.from, -lenDays), to: shiftDays(w.from, -1) };
}

/** ISO-8601 week number for the week containing `monday` — the real, textbook algorithm (finds
 *  that week's Thursday, which always falls in the ISO year the week belongs to). Market
 *  Momentum's week labels; callers using the Sat–Fri reporting week must pass the Monday WITHIN
 *  that bucket (`shiftDays(weekStart, 2)`), not the bucket's own Saturday start. */
export function isoWeekNo(monday: string): number {
  const dt = new Date(`${monday}T00:00:00Z`);
  const thursday = new Date(dt);
  thursday.setUTCDate(dt.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
