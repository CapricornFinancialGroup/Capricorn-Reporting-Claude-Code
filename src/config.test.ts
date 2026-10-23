// PBI 93610 settings: the data-version cache is on by default, can be switched off without a deploy,
// and a nonsense max-age falls back rather than disabling the bound.

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const KEYS = ["REPORTING_KEY_ON_DATA_VERSION", "REPORTING_VERSIONED_CACHE_MAX_SECONDS", "REPORTING_CACHE_TTL_SECONDS"] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("loadConfig — dataset cache settings", () => {
  it("defaults: keyed on the data version, 6 h bound, 45 s fallback TTL", () => {
    const c = loadConfig().reporting;
    expect(c.keyOnDataVersion).toBe(true);
    expect(c.versionedCacheMaxSeconds).toBe(21_600);
    expect(c.cacheTtlSeconds).toBe(45);
  });

  it("REPORTING_KEY_ON_DATA_VERSION=false (any case) is the rollback switch", () => {
    process.env.REPORTING_KEY_ON_DATA_VERSION = "false";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(false);
    process.env.REPORTING_KEY_ON_DATA_VERSION = "FALSE";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(false);
    process.env.REPORTING_KEY_ON_DATA_VERSION = "true";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(true);
  });

  it("a zero, negative or non-numeric max age falls back to the default instead of removing the bound", () => {
    for (const bad of ["0", "-5", "soon"]) {
      process.env.REPORTING_VERSIONED_CACHE_MAX_SECONDS = bad;
      expect(loadConfig().reporting.versionedCacheMaxSeconds).toBe(21_600);
    }
    process.env.REPORTING_VERSIONED_CACHE_MAX_SECONDS = "3600";
    expect(loadConfig().reporting.versionedCacheMaxSeconds).toBe(3600);
  });
});
