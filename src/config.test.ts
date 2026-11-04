// PBI 93610 settings: the data-version cache is on by default, can be switched off without a deploy,
// and a nonsense max-age falls back rather than disabling the bound.

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const KEYS = [
  "REPORTING_KEY_ON_DATA_VERSION",
  "REPORTING_VERSIONED_CACHE_MAX_SECONDS",
  "REPORTING_VERSION_PROBE_SECONDS",
  "REPORTING_CACHE_TTL_SECONDS",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("loadConfig — dataset cache settings", () => {
  it("defaults: keyed on the data version, 6 h bound, 45 s fallback TTL", () => {
    const c = loadConfig().reporting;
    expect(c.keyOnDataVersion).toBe(true);
    expect(c.versionedCacheMaxSeconds).toBe(21_600);
    expect(c.versionProbeSeconds).toBe(600);
    expect(c.cacheTtlSeconds).toBe(45);
  });

  it("the probe interval is configurable, and a nonsense value falls back to 10 minutes", () => {
    process.env.REPORTING_VERSION_PROBE_SECONDS = "300";
    expect(loadConfig().reporting.versionProbeSeconds).toBe(300);
    for (const bad of ["0", "-1", "often"]) {
      process.env.REPORTING_VERSION_PROBE_SECONDS = bad;
      expect(loadConfig().reporting.versionProbeSeconds).toBe(600);
    }
  });

  it("REPORTING_KEY_ON_DATA_VERSION=false (any case) is the rollback switch", () => {
    process.env.REPORTING_KEY_ON_DATA_VERSION = "false";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(false);
    process.env.REPORTING_KEY_ON_DATA_VERSION = "FALSE";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(false);
    process.env.REPORTING_KEY_ON_DATA_VERSION = "true";
    expect(loadConfig().reporting.keyOnDataVersion).toBe(true);
  });

  it("also reads 0, no and off, with stray whitespace, as off — an operator's 'off' must not be ignored", () => {
    for (const off of ["0", "no", "off", "Off", " false ", "NO\n"]) {
      process.env.REPORTING_KEY_ON_DATA_VERSION = off;
      expect(loadConfig().reporting.keyOnDataVersion, JSON.stringify(off)).toBe(false);
    }
    for (const on of ["", "   ", "true", "1", "yes", "on"]) {
      process.env.REPORTING_KEY_ON_DATA_VERSION = on;
      expect(loadConfig().reporting.keyOnDataVersion, JSON.stringify(on)).toBe(true);
    }
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

describe("loadConfig — cross-tenant Fabric sign-in", () => {
  const FABRIC = ["FABRIC_TENANT_ID", "FABRIC_CLIENT_ID", "FABRIC_CLIENT_SECRET", "FABRIC_MI_CLIENT_ID"] as const;
  afterEach(() => {
    for (const k of FABRIC) delete process.env[k];
  });

  it("unset: null, so the app keeps signing in with its own identity (today's Smartr-hosted behaviour)", () => {
    expect(loadConfig().fabric.crossTenant).toBeNull();
  });

  it("tenant + client id (+ MI client id): federated, no secret", () => {
    process.env.FABRIC_TENANT_ID = " 6267379f-7bab-4fc9-b4f2-7ce573e7f9b4 ";
    process.env.FABRIC_CLIENT_ID = "app-id";
    process.env.FABRIC_MI_CLIENT_ID = "uami-id";
    expect(loadConfig().fabric.crossTenant).toEqual({
      tenantId: "6267379f-7bab-4fc9-b4f2-7ce573e7f9b4",
      clientId: "app-id",
      clientSecret: "",
      managedIdentityClientId: "uami-id",
    });
  });

  it("carries the fallback secret when one is set", () => {
    process.env.FABRIC_TENANT_ID = "t";
    process.env.FABRIC_CLIENT_ID = "c";
    process.env.FABRIC_CLIENT_SECRET = "s";
    expect(loadConfig().fabric.crossTenant?.clientSecret).toBe("s");
  });

  it("half a setup stops startup rather than silently falling back to the wrong identity", () => {
    process.env.FABRIC_TENANT_ID = "t";
    expect(() => loadConfig()).toThrow(/FABRIC_TENANT_ID and FABRIC_CLIENT_ID/);
    delete process.env.FABRIC_TENANT_ID;
    process.env.FABRIC_CLIENT_ID = "c";
    expect(() => loadConfig()).toThrow(/FABRIC_TENANT_ID and FABRIC_CLIENT_ID/);
  });
});
