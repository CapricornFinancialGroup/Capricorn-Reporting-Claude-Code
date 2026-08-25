import { describe, expect, it } from "vitest";
import { PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import { referredProtectionSales } from "./referrals.js";
import { protectionWrittenDaily } from "./momentum.js";

const q = () => referredProtectionSales("2026-07-18", "2026-08-14");

describe("referredProtectionSales", () => {
  it("counts exactly the same sales as the board's protection written figure", () => {
    // If the referral board counted a different set, an adviser's credited referrals could exceed
    // the firm's own protection sales — the kind of internal contradiction this whole engagement
    // has been about.
    const text = q().text;
    expect(text).toContain(`p.${PROTECTION_WRITTEN_DATE}`);
    for (const s of PROTECTION_WRITTEN_STATUSES) expect(text).toContain(`'${s}'`);
    expect(text).toContain("DeletedYN");
    const written = protectionWrittenDaily("2026-07-18", "2026-08-14").text;
    expect(written).toContain(PROTECTION_WRITTEN_DATE);
  });

  it("attributes via the CLIENT, not the lead", () => {
    // protectioncase.LeadId and mortgagecase.LeadId are separate key spaces — they overlap on 63
    // rows table-wide and on ZERO of the 90 protection sales in a recent 4-week window. Joining on
    // them would silently attribute nothing at all.
    const text = q().text;
    expect(text).toContain("protectioncaseclient");
    expect(text).toContain("PrimaryClientKey = pc.ClientKey");
    expect(text).not.toMatch(/m\.LeadId\s*=\s*p\.LeadId/);
  });

  it("takes the EARLIEST mortgage on the client, not the latest", () => {
    // The adviser who brought the client in, rather than whoever wrote their most recent product.
    expect(q().text).toMatch(/ORDER BY\s+m\.LeadDate\b(?!\s+DESC)/);
  });

  it("uses only the primary client on the protection case", () => {
    // A joint case has two clients; counting both would double the sale.
    expect(q().text).toContain("PrimaryClientYN");
  });

  it("returns the originator and the converter separately, so credit can go to both", () => {
    const text = q().text;
    expect(text).toContain("originator");
    expect(text).toContain("converter");
    expect(text).toContain("commission");
  });

  it("keeps unattributable sales rather than dropping them", () => {
    // A LEFT JOIN, not an inner one: the screen states "76 of 90 attributed" instead of quietly
    // shrinking the denominator until the coverage looks perfect.
    const text = q().text;
    expect(text).toContain("LEFT JOIN dbo.protectioncaseclient");
    expect(text).toContain("OUTER APPLY");
  });

  it("scopes to the Capricorn entities and takes the window as parameters", () => {
    const built = q();
    expect(built.text).toContain("OrganisationKey");
    const names = built.params.map((p) => p.name);
    expect(names).toContain("From");
    expect(names).toContain("To");
    expect(built.params.find((p) => p.name === "From")?.value).toBe("2026-07-18");
  });
});

// The recipient of the 40% is RECORDED, not inferred — we told Kyle otherwise four times. See
// SPLIT_RECIPIENT_SOURCE in domain/data-quality.ts. These pin the ordering, because getting it the
// wrong way round put £45,882 of 2026 split commission on the wrong adviser.
describe("referredProtectionSales — the platform's own recipient comes first", () => {
  const q = () => referredProtectionSales("2026-08-01", "2026-08-07");

  it("reads SplitAdviserUserAccountKey, the column we wrongly said was absent", () => {
    expect(q().text).toContain("p.SplitAdviserUserAccountKey");
  });

  it("prefers the platform's adviser over the client-derived one", () => {
    // COALESCE order IS the policy: platform first, derivation second. Reversed, the derivation would
    // win wherever a client has any mortgage — which is most cases — and the recorded recipient would
    // never be used at all.
    expect(q().text).toMatch(/COALESCE\(sa\.Username,\s*mu\.Username\)/);
    expect(q().text).toMatch(/COALESCE\(sa\.FullName,\s*mu\.FullName\)/);
  });

  it("excludes sentinel keys rather than crediting a blank account", () => {
    // The Gold build writes COALESCE(key, -OrganisationKey), so an unresolved key arrives as −486 and
    // passes IS NOT NULL while naming nobody. Without this guard every unresolved split would credit
    // one blank useraccount row and it would climb the league.
    expect(q().text).toMatch(/p\.SplitAdviserUserAccountKey\s*>\s*0/);
    expect(q().text).not.toMatch(/SplitAdviserUserAccountKey\s+IS\s+NOT\s+NULL/);
  });

  it("keeps the client derivation as a fallback, not a replacement", () => {
    // The platform's column is empty on cases merged since ~July 2026 (upstream regression), so
    // dropping the derivation now would lose attribution on exactly the newest week the board shows.
    expect(q().text).toContain("PrimaryClientKey = pc.ClientKey");
    expect(q().text).toMatch(/ORDER BY\s+m\.LeadDate\b(?!\s+DESC)/);
  });

  it("says which source each row used, so the board can stop claiming it is all inferred", () => {
    expect(q().text).toContain("originatorSource");
    expect(q().text).toContain("'platform'");
    expect(q().text).toContain("'derived'");
  });

  it("still groups one row per originator/converter pair after the rewrite", () => {
    // The preference is computed in a derived table, so the GROUP BY has to name the OUTER columns —
    // grouping on the raw joins again would split one adviser pair across two rows.
    expect(q().text).toMatch(/GROUP BY s\.originator, s\.originatorName, s\.originatorSource, s\.converter, s\.converterName/);
  });
});
