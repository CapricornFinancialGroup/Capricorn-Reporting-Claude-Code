// Cross-tenant Fabric sign-in: no settings = the original same-tenant identity, untouched;
// federated = MI token for the token-exchange audience presented as the client assertion to the
// share's tenant; secret = the fallback.

import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({
  assertion: [] as Array<{ tenantId: string; clientId: string; getAssertion: () => Promise<string> }>,
  secret: [] as Array<{ tenantId: string; clientId: string; secret: string }>,
  mi: [] as Array<{ clientId?: string; scopes: string[] }>,
}));

vi.mock("@azure/identity", () => {
  class ClientAssertionCredential {
    constructor(tenantId: string, clientId: string, getAssertion: () => Promise<string>) {
      made.assertion.push({ tenantId, clientId, getAssertion });
    }
    async getToken() {
      return null;
    }
  }
  class ClientSecretCredential {
    constructor(tenantId: string, clientId: string, secret: string) {
      made.secret.push({ tenantId, clientId, secret });
    }
    async getToken() {
      return null;
    }
  }
  class ManagedIdentityCredential {
    record: { clientId?: string; scopes: string[] };
    constructor(opts?: { clientId?: string }) {
      this.record = { clientId: opts?.clientId, scopes: [] };
      made.mi.push(this.record);
    }
    async getToken(scope: string) {
      this.record.scopes.push(scope);
      return { token: "mi-token", expiresOnTimestamp: Date.now() + 3_600_000 };
    }
  }
  return { ClientAssertionCredential, ClientSecretCredential, ManagedIdentityCredential };
});

import type { Config, FabricCrossTenant } from "../../config.js";
import { TOKEN_EXCHANGE_SCOPE, buildFabricCredential, fabricAuthMode, fabricPool } from "./fabric-auth.js";

const SMARTR_TENANT = "6267379f-7bab-4fc9-b4f2-7ce573e7f9b4";
const APP_ID = "11111111-2222-3333-4444-555555555555";
const UAMI_ID = "99999999-8888-7777-6666-555555555555";

function crossTenant(overrides: Partial<FabricCrossTenant> = {}): FabricCrossTenant {
  return { tenantId: SMARTR_TENANT, clientId: APP_ID, clientSecret: "", managedIdentityClientId: UAMI_ID, ...overrides };
}

function config(ct: FabricCrossTenant | null | undefined): Config {
  return { fabric: { endpoint: "x.datawarehouse.fabric.microsoft.com", database: "GAGold_Capricorn", crossTenant: ct } } as Config;
}

beforeEach(() => {
  made.assertion.length = 0;
  made.secret.length = 0;
  made.mi.length = 0;
});

describe("fabricAuthMode", () => {
  it("no cross-tenant settings is the same-tenant managed identity", () => {
    expect(fabricAuthMode(null)).toBe("managed-identity");
    expect(fabricAuthMode(undefined)).toBe("managed-identity");
  });
  it("settings without a secret are federated; with one, the secret fallback", () => {
    expect(fabricAuthMode(crossTenant())).toBe("federated");
    expect(fabricAuthMode(crossTenant({ clientSecret: "s3cret" }))).toBe("client-secret");
  });
});

describe("buildFabricCredential", () => {
  it("returns nothing without settings, so the pool keeps azure-active-directory-default", () => {
    expect(buildFabricCredential(null)).toBeUndefined();
    expect(made.assertion).toHaveLength(0);
    expect(made.secret).toHaveLength(0);
  });

  it("federated: asks the SHARE's tenant as the multi-tenant app, asserting with the user-assigned MI's exchange token", async () => {
    expect(buildFabricCredential(crossTenant())).toBeDefined();
    expect(made.assertion).toHaveLength(1);
    const [a] = made.assertion;
    expect(a.tenantId).toBe(SMARTR_TENANT);
    expect(a.clientId).toBe(APP_ID);

    expect(await a.getAssertion()).toBe("mi-token");
    expect(made.mi).toEqual([{ clientId: UAMI_ID, scopes: [TOKEN_EXCHANGE_SCOPE] }]);
    expect(TOKEN_EXCHANGE_SCOPE).toBe("api://AzureADTokenExchange/.default");
    expect(made.secret).toHaveLength(0);
  });

  it("federated with no MI client id uses the system-assigned identity", async () => {
    buildFabricCredential(crossTenant({ managedIdentityClientId: "" }));
    await made.assertion[0].getAssertion();
    expect(made.mi).toEqual([{ clientId: undefined, scopes: [TOKEN_EXCHANGE_SCOPE] }]);
  });

  it("secret fallback: a client-secret credential against the share's tenant, no managed identity involved", () => {
    buildFabricCredential(crossTenant({ clientSecret: "s3cret" }));
    expect(made.secret).toEqual([{ tenantId: SMARTR_TENANT, clientId: APP_ID, secret: "s3cret" }]);
    expect(made.assertion).toHaveLength(0);
    expect(made.mi).toHaveLength(0);
  });
});

describe("fabricPool", () => {
  it("same-tenant: exactly the pool options every call site built before", () => {
    expect(fabricPool(config(null))).toEqual({ server: "x.datawarehouse.fabric.microsoft.com", database: "GAGold_Capricorn" });
    expect(fabricPool(config(undefined))).not.toHaveProperty("credential");
  });

  it("cross-tenant: carries the credential, and reuses ONE instance so its token cache survives across queries", () => {
    const c = config(crossTenant());
    const first = fabricPool(c);
    const second = fabricPool(c);
    expect(first.credential).toBeDefined();
    expect(second.credential).toBe(first.credential);
    expect(made.assertion).toHaveLength(1);
  });
});
