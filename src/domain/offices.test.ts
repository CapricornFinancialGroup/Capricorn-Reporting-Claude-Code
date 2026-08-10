// The office mapping is configuration, and it has silently broken twice in ways that made a whole
// office read as zero: Newmarket pointed at retired shirefinance.co.uk logins, and a "Türkiye"
// office that does not exist swallowed two advisers. Both looked like quiet trading, not a bug.
// These tests pin every ruling Capricorn has actually given us.

import { describe, expect, it } from "vitest";
import { OFFICES, UNASSIGNED, officeOf } from "./offices.js";

describe("officeOf", () => {
  it("is case- and whitespace-insensitive (logins arrive both ways from the lake)", () => {
    expect(officeOf("  Heather.Reed@CapricornFinancialMortgages.co.uk  ")).toBe("Newmarket");
  });

  it("returns Unassigned rather than throwing on a missing or unknown adviser", () => {
    expect(officeOf(null)).toBe(UNASSIGNED);
    expect(officeOf("")).toBe(UNASSIGNED);
    expect(officeOf("nobody@example.com")).toBe(UNASSIGNED);
  });
});

describe("Kyle's rulings", () => {
  // 2026-08-07
  it.each([
    ["harvey.laming@capricornfinancialmortgages.co.uk", "Mayfair"],
    ["shahida.rashid@capricornfinancialmortgages.co.uk", "Mayfair"],
    ["nathan.hookway@capricornfinancialmortgages.co.uk", "Hammersmith"],
    ["philip.ndegwa@capricornfinancialmortgages.co.uk", "Hammersmith"],
    ["berkan.aksit@capricornint.co.uk", "Hammersmith"],
    ["gizem@capricorncommercial.co.uk", "Hammersmith"],
  ])("%s → %s", (login, office) => {
    expect(officeOf(login)).toBe(office);
  });

  // 2026-08-10 — closing out the rest of the Unassigned list.
  it.each([
    ["michael.ngoka@capricornfinancialmortgages.co.uk", "Hammersmith"],
    ["tyron@capricornfinancialmortgages.co.uk", "Hammersmith"],
    ["patricia.mcnicholas@capricorncommercial.co.uk", "Hammersmith"],
    ["arandeep.purewal@capricornfinancialmortgages.co.uk", "Mayfair"],
    ["emelia@capricornint.co.uk", "Singapore"],
  ])("%s → %s", (login, office) => {
    expect(officeOf(login)).toBe(office);
  });

  it("places Michael Ngoka, who carries £13,948 on Capricorn's own Written Report", () => {
    // He was invisible for weeks: the Unassigned card read only lead counts, and he is a protection
    // adviser who sources none. A mortgage-only audit could not have found him.
    expect(officeOf("michael.ngoka@capricornfinancialmortgages.co.uk")).not.toBe(UNASSIGNED);
  });
});

describe("Newmarket", () => {
  it("maps its three current advisers — Heather, Jonathan and Charlie", () => {
    for (const login of [
      "heather.reed@capricornfinancialmortgages.co.uk",
      "jonathan.darrell@capricornfinancialmortgages.co.uk",
      "charlie.crisp@capricornfinancialmortgages.co.uk",
    ]) {
      expect(officeOf(login), login).toBe("Newmarket");
    }
  });

  it("keeps the retired Shire logins so historical cases still land in Newmarket", () => {
    expect(officeOf("heather@shirefinance.co.uk")).toBe("Newmarket");
    expect(officeOf("gary@shirefinance.co.uk")).toBe("Newmarket");
  });
});

describe("office roster", () => {
  it("every mapped office is a real office on the roster", () => {
    // A typo'd office name would create a phantom office that silently collects business — the
    // "Türkiye" failure. Guard it by construction.
    const roster = new Set(OFFICES.map((o) => o.name));
    for (const login of [
      "michael.ngoka@capricornfinancialmortgages.co.uk",
      "emelia@capricornint.co.uk",
      "arandeep.purewal@capricornfinancialmortgages.co.uk",
      "heather.reed@capricornfinancialmortgages.co.uk",
      "berkan.aksit@capricornint.co.uk",
    ]) {
      expect(roster.has(officeOf(login)), `${login} → ${officeOf(login)}`).toBe(true);
    }
  });

  it("has no Türkiye office — Conor confirmed it does not exist", () => {
    expect(OFFICES.map((o) => o.name)).not.toContain("Türkiye");
    expect(officeOf("berkan.aksit@capricornint.co.uk")).toBe("Hammersmith");
  });
});
