// The Capricorn firms in the GAGold_Capricorn share. Every query scopes to these OrganisationKeys
// (the share also physically contains only these two firms — the filter is belt-and-braces and
// keeps the SQL portable to a wider warehouse).

export interface Organisation {
  key: number;
  orgId: string;
  name: string;
  shortName: string;
}

export const ORGANISATIONS: Organisation[] = [
  { key: 411, orgId: "1MEQ16C", name: "Capricorn Financial Consultancy", shortName: "Consultancy" },
  { key: 486, orgId: "1Q1M7BJ", name: "Capricorn Financial Mortgages Limited", shortName: "Mortgages" },
];

export const ORGANISATION_KEYS: number[] = ORGANISATIONS.map((o) => o.key);
