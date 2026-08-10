// Adviser → office attribution.
//
// The lake's `useraccount` table carries no office/branch column, so office attribution is a
// versioned config file. Source: Capricorn's "Adviser Mapping" export from Datarails (Kyle Van Der
// Net, 2026-07-06) — the "Adviser" column joined by name to the lake advisers on Capricorn cases
// (111 of 114 matched; the misses are a shared `cs@` inbox, a test account, and one adviser absent
// from the sheet). Keyed by the lake `useraccount.Username` (email), lower-cased, because that is
// what flows through `officeOf(adv.Username)`. Unmapped advisers roll up under "Unassigned" —
// deliberately VISIBLE on the leaderboards so a stale mapping is obvious.
//
// To refresh: re-run the name-match when Capricorn sends the promised adviser-email list (a direct
// email join will replace the name match and pick up the ~3 gaps).

export interface Office {
  name: string;
  /** Accent used for charts/pills. */
  color: string;
}

// Conor's confirmed office list + order (2026-07-07 email): "There is no Turkey office." Türkiye
// removed entirely (was 2 advisers, see ADVISER_OFFICE below — now UNASSIGNED pending Capricorn
// telling us their real office). Dubai's status wasn't addressed by that email (it was carried
// over from Kyle's original Datarails export as "a valid office" with no case advisers yet) —
// left in for now, flagged separately rather than guessed at.
export const OFFICES: Office[] = [
  { name: "Hammersmith", color: "#0E2040" },
  { name: "Mayfair", color: "#1D4ED8" },
  { name: "Newmarket", color: "#0E7490" },
  { name: "Hong Kong", color: "#7C3AED" },
  { name: "Shanghai", color: "#BE185D" },
  { name: "Singapore", color: "#B45309" },
  { name: "Dubai", color: "#0F766E" },
];

export const UNASSIGNED = "Unassigned";

/** username (lower-cased) → office name. From the Datarails Adviser Mapping export (2026-07-06). */
export const ADVISER_OFFICE: Record<string, string> = {
  "albano@capricornfinancial.co.uk": "Hammersmith",
  "albano@capricornfinancialmortgages.co.uk": "Hammersmith",
  "alex.bennett@capricornfinancial.co.uk": "Hammersmith",
  "alex.bennett@capricornfinancialmortgages.co.uk": "Hammersmith",
  "alex.tizzard@capricornfinancial.co.uk": "Hammersmith",
  "alex.tizzard@capricornfinancialmortgages.co.uk": "Hammersmith",
  "billel@capricornfinancialmortgages.co.uk": "Hammersmith",
  "brad.starkey@capricornfinancialmortgages.co.uk": "Hammersmith",
  "britanny@capricornfinancial.co.uk": "Hammersmith",
  "britanny@capricornfinancialmortgages.co.uk": "Hammersmith",
  "chelsea.mitchell@capricornfinancial.co.uk": "Hammersmith",
  "chelsea.mitchell@capricornfinancialmortgages.co.uk": "Hammersmith",
  "chris.szeto@capricornint.co.uk": "Hammersmith",
  "dale@capricornfinancial.co.uk": "Hammersmith",
  "dale@capricornfinancialmortgages.co.uk": "Hammersmith",
  "daniel.white@capricornfinancial.co.uk": "Hammersmith",
  "daniel.white@capricornfinancialmortgages.co.uk": "Hammersmith",
  "henry@capricornfinancial.co.uk": "Hammersmith",
  "henry@capricornfinancialmortgages.co.uk": "Hammersmith",
  "ife@capricornfinancialmortgages.co.uk": "Hammersmith",
  "jack.sparrow@capricornfinancialmortgages.co.uk": "Hammersmith",
  "jack@capricornfinancialmortgages.co.uk": "Hammersmith",
  "jacob@capricornfinancial.co.uk": "Hammersmith",
  "jacob@capricornfinancialmortgages.co.uk": "Hammersmith",
  "james.hamber@capricornfinancialmortgages.co.uk": "Hammersmith",
  "james.sinclair@capricornfinancial.co.uk": "Hammersmith",
  "james.sinclair@capricornfinancialmortgages.co.uk": "Hammersmith",
  "james.storer@capricornfinancial.co.uk": "Hammersmith",
  "james.storer@capricornfinancialmortgages.co.uk": "Hammersmith",
  "james@hamber.co.uk": "Hammersmith",
  "jamie@capricornfinancial.co.uk": "Hammersmith",
  "jamie@capricornfinancialmortgages.co.uk": "Hammersmith",
  "joe@capricornfinancial.co.uk": "Hammersmith",
  "joe@capricornfinancialmortgages.co.uk": "Hammersmith",
  "john@smyth.com": "Hammersmith",
  "jordan@capricornfinancial.co.uk": "Hammersmith",
  "jordan@capricornfinancialmortgages.co.uk": "Hammersmith",
  "jules.pirko@capricornfinancialmortgages.co.uk": "Hammersmith",
  "karina@capricornfinancial.co.uk": "Hammersmith",
  "karina@capricornfinancialmortgages.co.uk": "Hammersmith",
  "karwan@capricornfinancial.co.uk": "Hammersmith",
  "karwan@capricornfinancialmortgages.co.uk": "Hammersmith",
  "kishan.mistry@capricornfinancial.co.uk": "Hammersmith",
  "kishan.mistry@capricornfinancialmortgages.co.uk": "Hammersmith",
  "krishan@capricornfinancial.co.uk": "Hammersmith",
  "krishan@capricornfinancialmortgages.co.uk": "Hammersmith",
  "lateef.ullah@capricornfinancialmortgages.co.uk": "Hammersmith",
  "leighton@capricornfinancialmortgages.co.uk": "Hammersmith",
  "lera@capricorncommercial.co.uk": "Hammersmith",
  "lewis@capricornfinancial.co.uk": "Hammersmith",
  "lewis@capricornfinancialmortgages.co.uk": "Hammersmith",
  "linhua@capricornfinancial.co.uk": "Hammersmith",
  "linhua@capricornfinancialmortgages.co.uk": "Hammersmith",
  "luke@capricornfinancial.co.uk": "Hammersmith",
  "luke@capricornfinancialmortgages.co.uk": "Hammersmith",
  "marcus.law@capricornfinancialmortgages.co.uk": "Hammersmith",
  "mark.harkin@capricornfinancialmortgages.co.uk": "Hammersmith",
  "mason@capricornfinancial.co.uk": "Hammersmith",
  "mason@capricornfinancialmortgages.co.uk": "Hammersmith",
  "nioosha@capricornfinancial.co.uk": "Hammersmith",
  "nioosha@capricornfinancialmortgages.co.uk": "Hammersmith",
  "pedro@capricornfinancial.co.uk": "Hammersmith",
  "pedro@capricornfinancialmortgages.co.uk": "Hammersmith",
  "raj@capricornfinancial.co.uk": "Hammersmith",
  "raj@capricornfinancialmortgages.co.uk": "Hammersmith",
  "roberto.seresoan@capricornfinancial.co.uk": "Hammersmith",
  "roberto@capricornfinancialmortgages.co.uk": "Hammersmith",
  "romeo@capricornfinancial.co.uk": "Hammersmith",
  "romeo@capricornfinancialmortgages.co.uk": "Hammersmith",
  "ross.culley@capricornfinancial.co.uk": "Hammersmith",
  "ross.culley@capricornfinancialmortgages.co.uk": "Hammersmith",
  "ross.murphy@capricornfinancial.co.uk": "Hammersmith",
  "ross.murphy@capricornfinancialmortgages.co.uk": "Hammersmith",
  "sean@capricornfinancial.co.uk": "Hammersmith",
  "sean@capricornfinancialmortgages.co.uk": "Hammersmith",
  "sherene@capricornfinancialmortgages.co.uk": "Hammersmith",
  "simon.welford@capricornfinancial.co.uk": "Hammersmith",
  "steve.hills@capricorncommercial.co.uk": "Hammersmith",
  "tianna@capricornfinancial.co.uk": "Hammersmith",
  "tianna@capricornfinancialmortgages.co.uk": "Hammersmith",
  "tim.aspinall@capricornfinancialmortgages.co.uk": "Hammersmith",
  "toby.scottmason@capricornfinancialmortgages.co.uk": "Hammersmith",
  "tony.chryseliou@capricornfinancial.co.uk": "Hammersmith",
  "tony.chryseliou@capricornfinancialmortgages.co.uk": "Hammersmith",
  "tyke@capricornfinancial.co.uk": "Hammersmith",
  "tyke@capricornfinancialmortgages.co.uk": "Hammersmith",
  "wentao@capricornfinancial.co.uk": "Hammersmith",
  "wentao@capricornfinancialmortgages.co.uk": "Hammersmith",
  "andy.lansbury@capricornint.co.uk": "Hong Kong",
  "gavin@capricornint.co.uk": "Hong Kong",
  "alex.smith@capricornfinancial.co.uk": "Mayfair",
  "alex.smith@capricornfinancialmortgages.co.uk": "Mayfair",
  "armani@capricornfinancial.co.uk": "Mayfair",
  "armani@capricornfinancialmortgages.co.uk": "Mayfair",
  "manny@capricornfinancial.co.uk": "Mayfair",
  "manny@capricornfinancialmortgages.co.uk": "Mayfair",
  "priti@capricornfinancial.co.uk": "Mayfair",
  "priti@capricornfinancialmortgages.co.uk": "Mayfair",
  "rina.sen@capricornfinancialmortgages.co.uk": "Mayfair",
  "virginia.lee@capricornfinancialmortgages.co.uk": "Mayfair",
  // Newmarket came in from Shire Finance, and the mapping still keyed on their OLD shirefinance.co.uk
  // logins. Every one of those was retired when they moved onto Capricorn addresses, so from the
  // board's point of view the entire office had no advisers — which is why Newmarket read 0 leads,
  // 0 apps, 0 refs, 0 sales while Heather Reed alone was writing 6 applications a week (Kyle,
  // 2026-08-06: "how does NewMarket have not activity?"). Her business was landing in Unassigned.
  //
  // Matched on full name against the retired accounts (verified in dbo.useraccount 2026-08-07):
  //   charlie@shirefinance.co.uk  → Charlie Crisp      → charlie.crisp@capricornfinancialmortgages.co.uk
  //   heather@shirefinance.co.uk  → Heather Reed       → heather.reed@capricornfinancialmortgages.co.uk
  //   jonathan@shirefinance.co.uk → Jonathan Darrell   → jonathan.darrell@capricornfinancialmortgages.co.uk
  // gary@shirefinance.co.uk has no current Capricorn account — presumed a leaver, so no replacement
  // entry. The old logins are KEPT so historical cases written under them still map to Newmarket.
  "charlie@shirefinance.co.uk": "Newmarket",
  "gary@shirefinance.co.uk": "Newmarket",
  "heather@shirefinance.co.uk": "Newmarket",
  "jonathan@shirefinance.co.uk": "Newmarket",
  "charlie.crisp@capricornfinancialmortgages.co.uk": "Newmarket",
  "heather.reed@capricornfinancialmortgages.co.uk": "Newmarket",
  "jonathan.darrell@capricornfinancialmortgages.co.uk": "Newmarket",
  "sarah@capricornint.co.uk": "Shanghai",
  "sam.lee@capricornfinancial.co.uk": "Singapore",
  "sam.lee@capricornfinancialmortgages.co.uk": "Singapore",
  "samuel@capricornint.co.uk": "Singapore",
  "shirlene@koh.co.uk": "Singapore",
  // Ruled by Kyle 2026-08-07, from the Unassigned list the board surfaced. He also confirmed Gary
  // has left Newmarket and that its three advisers are Heather, Jonathan and Charlie (mapped above).
  // Kyle gives a team alongside each office ("Mayfair (Team Manny)"); teams are not a dimension the
  // board carries yet, so they are recorded here as the provenance of the ruling, not as data.
  "harvey.laming@capricornfinancialmortgages.co.uk": "Mayfair", // Team Manny
  "shahida.rashid@capricornfinancialmortgages.co.uk": "Mayfair", // Team Alex
  "nathan.hookway@capricornfinancialmortgages.co.uk": "Hammersmith", // Team Jordan
  "philip.ndegwa@capricornfinancialmortgages.co.uk": "Hammersmith", // Team Tony
  // Both were on a "Türkiye" office in the Datarails export; Conor confirmed 2026-07-07 that no such
  // office exists, and Kyle placed them in Hammersmith (Team Sam) on that basis 2026-08-07.
  "berkan.aksit@capricornint.co.uk": "Hammersmith", // Team Sam
  "gizem@capricorncommercial.co.uk": "Hammersmith", // Team Sam
  // Ruled by Kyle 2026-08-10, closing out the remaining Unassigned advisers the board named. Michael
  // Ngoka is the one that mattered: 78 protection cases and £13,948 on Kyle's own Written Report,
  // invisible as an office until the Unassigned card was widened past leads.
  "michael.ngoka@capricornfinancialmortgages.co.uk": "Hammersmith", // Team Tim, protection adviser
  "tyron@capricornfinancialmortgages.co.uk": "Hammersmith",
  "patricia.mcnicholas@capricorncommercial.co.uk": "Hammersmith",
  "arandeep.purewal@capricornfinancialmortgages.co.uk": "Mayfair", // Team Manny
  "emelia@capricornint.co.uk": "Singapore",
};

/** Resolve an adviser's office; unmapped advisers group under UNASSIGNED. */
export function officeOf(username: string | null | undefined): string {
  if (!username) return UNASSIGNED;
  return ADVISER_OFFICE[username.trim().toLowerCase()] ?? UNASSIGNED;
}

/** Conor's fixed display order (2026-07-07: "Office Order"), for screens that should show a
 *  stable roster position rather than reshuffling by performance every refresh (Office Run
 *  Chase). Unknown/unassigned names sort last. */
export function officeOrderIndex(name: string): number {
  const i = OFFICES.findIndex((o) => o.name === name);
  return i === -1 ? OFFICES.length : i;
}

/** The office display list: the real offices, plus Unassigned only when it has activity. */
export function officeNames(includeUnassigned: boolean): string[] {
  const names = OFFICES.map((o) => o.name);
  return includeUnassigned ? [...names, UNASSIGNED] : names;
}
