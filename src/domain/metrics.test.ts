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
    // These are unresolved with Capricorn as of 2026-08-04. If one is downgraded to "agreed", it must
    // be because Kyle ruled — not because the note was tidied away.
    for (const key of ["referrals", "sales", "attach-rate"]) {
      expect(metricDefinition(key)?.status, `${key} is still awaiting a Capricorn ruling`).toBe("open");
    }
  });
});
