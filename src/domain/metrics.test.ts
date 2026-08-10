// The dictionary is only worth having if it stays complete and honest, so those two properties are
// asserted rather than trusted. Conor's objective (2026-08-04) — "nobody ever needs to send an email
// asking why one number differs from another" — fails the moment a tile has no definition, a label
// drifts from the screen, or a caveat gets quietly dropped from a metric that is still disputed.

import { describe, expect, it } from "vitest";
import { METRIC_DEFINITIONS, metricDefinition } from "./metrics.js";
import { KPI_KEYS, KPI_LABELS } from "./targets.js";

describe("metric dictionary", () => {
  it("covers every KPI the run-chase screens render, under the SAME label", () => {
    for (const k of KPI_KEYS) {
      const m = metricDefinition(k);
      expect(m, `KPI "${k}" has no definition — its tile would show no ⓘ`).toBeDefined();
      // A dictionary that calls a tile something else is worse than none: the reader can't match them.
      expect(m?.label, `definition label for "${k}" must match the on-screen label`).toBe(KPI_LABELS[k]);
    }
  });

  it("covers the derived tiles that carry their own definition", () => {
    for (const key of ["offers", "written", "revenue", "total-lending", "case-size", "attach-rate", "pace"]) {
      expect(metricDefinition(key), `tile "${key}" has no definition`).toBeDefined();
    }
  });

  it("has unique keys", () => {
    const keys = METRIC_DEFINITIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fills every contract field — a blank owner or frequency defeats the point", () => {
    for (const m of METRIC_DEFINITIONS) {
      for (const field of ["label", "definition", "calculation", "source", "owner", "frequency"] as const) {
        expect(m[field]?.trim(), `${m.key}.${field} must not be empty`).toBeTruthy();
      }
    }
  });

  it("makes anything not fully agreed explain itself", () => {
    // An "indicative" or "open" metric without a note is the exact failure mode that generated the
    // July/August email traffic: a figure flagged as uncertain with no statement of why.
    for (const m of METRIC_DEFINITIONS.filter((x) => x.status !== "agreed")) {
      expect(m.note?.trim(), `${m.key} is "${m.status}" so it must carry a note explaining why`).toBeTruthy();
    }
  });

  it("keeps the metrics with live open questions marked open", () => {
    // Still unresolved with Capricorn. If one is downgraded to "agreed", it must be because Kyle
    // ruled — not because the note was tidied away.
    //
    // `sales` came OFF this list on 2026-08-04: Kyle ruled ("the 'Written' for protection should be
    // as per the written report"), and the board now reproduces his figure — £68,951 against the
    // c.£69K he quoted for Sat 25–31 Jul. That is a ruling plus a reconciliation, which is the bar.
    for (const key of ["referrals", "attach-rate"]) {
      expect(metricDefinition(key)?.status, `${key} is still awaiting a Capricorn ruling`).toBe("open");
    }
  });

  it("states what a fee IS wherever a metric mentions fees", () => {
    // Kyle, 2026-08-04: "Could you advise what Commission is + Fees? What are the fees referring to?"
    // A tile that shows two things has to name both, or it generates that email again.
    const revenue = metricDefinition("revenue");
    expect(revenue?.calculation.toLowerCase()).toContain("client fee");
  });

  it("does NOT claim written commission includes client fees", () => {
    // Kyle, 2026-08-10: "Please can we completely separate the Client Fee – as our written report
    // does not capture the client fee." The tile stopped adding it; if this dictionary entry still
    // said it did, the ⓘ panel would contradict the number beside it — which is the precise failure
    // the dictionary exists to prevent.
    const revenue = metricDefinition("revenue");
    expect(revenue?.definition.toLowerCase()).toContain("not included");
    expect(revenue?.calculation.toLowerCase()).toContain("not added");
    expect(revenue?.source).not.toContain("+ mortgagecase.ClientFeeAmount");
  });
});
