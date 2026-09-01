// England & Wales bank holidays — the days Capricorn's London offices are shut.
//
// WHY THIS EXISTS. Monday 31 August 2026 was the summer bank holiday. The board had no concept of
// one, so it handed that Monday a full weekday target — 122 leads, 23 mortgages, 12 protection
// referrals, 12 protection sales — and on the Tuesday morning reported the firm 136 leads and 20
// mortgages behind for a three-day weekend nobody worked. Kyle's own email that morning opened
// "trust you had a good long weekend", which is the tell: everybody in the business knew it was a
// holiday except the wall.
//
// It is the same defect as the Saturday protection expectation Kyle ruled on 2026-08-25 — a target
// placed on a day the work was never going to happen — and it fails the same way, by teaching people
// that red on the board means nothing.
//
// SCOPE IS DELIBERATELY ENGLAND & WALES. The three offices that carry essentially all the volume and
// all the targets are Hammersmith, Mayfair and Newmarket. Hong Kong, Singapore and Shanghai keep
// their own calendars and would each need their own list; their weekly targets are 9–18 leads, so a
// wrong day shape there moves the board by well under one case and is not worth the complexity until
// the offices themselves are worth pacing. Recorded so the next person does not assume it was missed.
//
// MAINTENANCE. Hand-listed rather than computed: the substitute-day rules ("if it falls on a
// weekend, the following Monday") plus the Easter cycle plus one-off royal holidays are more code
// than a list, and a list is auditable at a glance. Runs out at the end of 2027 — `bankHolidayCover`
// reports the last covered date so a health check can say so out loud rather than silently treating
// every future holiday as a working day.

/** England & Wales bank holidays, ISO dates. Source: GOV.UK. */
const UK_BANK_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-04-03", // Good Friday
  "2026-04-06", // Easter Monday
  "2026-05-04", // Early May bank holiday
  "2026-05-25", // Spring bank holiday
  "2026-08-31", // Summer bank holiday  ← the one that started this
  "2026-12-25", // Christmas Day
  "2026-12-28", // Boxing Day (substitute — 26 Dec is a Saturday)
  // 2027
  "2027-01-01", // New Year's Day
  "2027-03-26", // Good Friday
  "2027-03-29", // Easter Monday
  "2027-05-03", // Early May bank holiday
  "2027-05-31", // Spring bank holiday
  "2027-08-30", // Summer bank holiday
  "2027-12-27", // Christmas Day (substitute — 25 Dec is a Saturday)
  "2027-12-28", // Boxing Day (substitute — 26 Dec is a Sunday)
]);

/** Last date the list above covers. Past this, every day looks like a working day again. */
export const BANK_HOLIDAY_COVER_THROUGH = "2027-12-31" as const;

/** KNOWN GAP — CHRISTMAS. This is a list of statutory bank holidays, not of days Capricorn is shut,
 *  and over Christmas those differ. In 2026 Boxing Day falls on Saturday 26 December: the bank holiday
 *  is substituted forward to Monday the 28th, so the 26th is not on the list above — but the offices
 *  will be closed, and Saturday is a trading day on this board (~36 leads), so that Saturday will be
 *  handed a target it cannot meet. The same applies to 27–31 December in most years, when the business
 *  is open only nominally.
 *
 *  Not guessed at here: which days Capricorn actually works between Christmas and New Year is theirs
 *  to say, not ours to infer, and it is the sort of assumption that has already cost this board its
 *  credibility twice. Ask before December and add the closure dates as a second list. */

/** Is this an England & Wales bank holiday — a day the London offices are shut? */
export function isBankHoliday(iso: string): boolean {
  return UK_BANK_HOLIDAYS.has(iso);
}

/** Bank holidays falling inside [from, to] inclusive, ascending. */
export function bankHolidaysBetween(from: string, to: string): string[] {
  return [...UK_BANK_HOLIDAYS].filter((d) => d >= from && d <= to).sort();
}
