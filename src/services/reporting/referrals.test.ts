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
