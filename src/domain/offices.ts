// Adviser → office attribution.
//
// The lake's `useraccount` table carries no office/branch column, so office attribution is a
// versioned config file: map adviser usernames (lower-cased) to one of the six offices. Unmapped
// advisers roll up under "Unassigned" — deliberately VISIBLE on the leaderboards so a stale mapping
// is obvious rather than silently mis-attributed.
//
// PLACEHOLDER — Capricorn (Conor/Kyle) to supply the real adviser→office list. Until then every
// adviser reads as Unassigned and the six offices sit at zero.

export interface Office {
  name: string;
  /** Accent used for charts/pills. */
  color: string;
}

export const OFFICES: Office[] = [
  { name: "Hammersmith", color: "#0E2040" },
  { name: "Mayfair", color: "#1D4ED8" },
  { name: "Newmarket", color: "#0E7490" },
  { name: "Hong Kong", color: "#7C3AED" },
  { name: "Singapore", color: "#B45309" },
  { name: "Shanghai", color: "#BE185D" },
];

export const UNASSIGNED = "Unassigned";

/** username (lower-cased) → office name. PLACEHOLDER — awaiting Capricorn's mapping. */
export const ADVISER_OFFICE: Record<string, string> = {
  // "sean.keller@capricornfinancialmortgages.co.uk": "Hammersmith",
};

/** Resolve an adviser's office; unmapped advisers group under UNASSIGNED. */
export function officeOf(username: string | null | undefined): string {
  if (!username) return UNASSIGNED;
  return ADVISER_OFFICE[username.trim().toLowerCase()] ?? UNASSIGNED;
}

/** The office display list: the six real offices, plus Unassigned only when it has activity. */
export function officeNames(includeUnassigned: boolean): string[] {
  const names = OFFICES.map((o) => o.name);
  return includeUnassigned ? [...names, UNASSIGNED] : names;
}
