// The authentication block handed to tedious: unchanged without a credential, token-credential with one.

import { afterEach, describe, expect, it, vi } from "vitest";

const configs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("mssql", () => {
  class ConnectionPool {
    constructor(cfg: Record<string, unknown>) {
      configs.push(cfg);
    }
    async connect() {
      return this;
    }
    async close() {}
  }
  return { default: { ConnectionPool } };
});

import type { TokenCredential } from "@azure/identity";
import { closeAllPools, getPool } from "./sql-pool.js";

afterEach(async () => {
  configs.length = 0;
  await closeAllPools();
});

describe("getPool authentication", () => {
  it("no credential: azure-active-directory-default, exactly as before", async () => {
    await getPool({ server: "a", database: "db" });
    await getPool({ server: "b", database: "db", clientId: "uami" });
    expect(configs[0].authentication).toEqual({ type: "azure-active-directory-default", options: {} });
    expect(configs[1].authentication).toEqual({ type: "azure-active-directory-default", options: { clientId: "uami" } });
  });

  it("with a credential: token-credential carrying it", async () => {
    const credential: TokenCredential = { getToken: async () => null };
    await getPool({ server: "c", database: "db", credential });
    expect(configs[0].authentication).toEqual({ type: "token-credential", options: { credential } });
  });
});
