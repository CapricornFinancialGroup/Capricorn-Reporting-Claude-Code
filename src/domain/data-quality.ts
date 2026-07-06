// Data-quality exclusions — known one-off data events that would distort the run chase.
//
// The Capricorn Financial Mortgages (org 486) back-book was migrated onto the platform at go-live
// and ~4,094 historical leads were bulk-stamped with LeadDate = 2026-07-01 (vs a normal ~120/day).
// They're real leads but mis-dated to the migration date, so counting them as "new leads on 1 Jul"
// makes the week read ~34× high. We exclude that batch from mortgagecase metrics.
//
// Versioned + documented on purpose (not a magic literal in SQL). Extend the list if further bulk
// events land; remove an entry if Capricorn confirms a batch should count.

export interface MigrationExclusion {
  orgKey: number;
  /** YYYY-MM-DD — the LeadDate the batch was stamped with. */
  leadDate: string;
  note: string;
}

export const MIGRATION_EXCLUSIONS: MigrationExclusion[] = [
  { orgKey: 486, leadDate: "2026-07-01", note: "CFM go-live back-book migration (~4,094 leads bulk-dated 1 Jul)" },
];
