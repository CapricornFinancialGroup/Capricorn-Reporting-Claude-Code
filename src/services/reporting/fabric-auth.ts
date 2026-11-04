// How the app signs in to the Fabric lakehouse share.
//
// The share lives in Smartr365's tenant. While the app ran in Smartr's Azure, its own managed
// identity was a member of that tenant and was granted Viewer on the workspace directly, so tedious'
// `azure-active-directory-default` (DefaultAzureCredential) was all it needed. That is still the
// default: with no FABRIC_* identity settings, nothing here changes.
//
// Running in Capricorn's own tenant, the app's managed identity is a stranger to Smartr's tenant.
// It reaches the share through a multi-tenant app registration that lives in Capricorn's tenant and
// is provisioned (as a service principal, granted Viewer) in Smartr's:
//
//   federated (preferred, no secret): the app registration trusts the app's user-assigned managed
//     identity through a federated identity credential. We get an MI token for the token-exchange
//     audience and present it as the client assertion when asking Smartr's tenant for a SQL token.
//   client-secret (fallback): the same app registration, signed in with a client secret. Use only
//     if the federated route is refused; the secret expires and must be rotated.
//
// Blob storage and Key Vault are untouched: they are in Capricorn's tenant and keep using
// DefaultAzureCredential (the system-assigned identity).

import {
  ClientAssertionCredential,
  ClientSecretCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import type { Config, FabricCrossTenant } from "../../config.js";
import type { PoolOpts } from "./sql-pool.js";

/** The audience Entra accepts a managed-identity token for when it is used as a federated credential. */
export const TOKEN_EXCHANGE_SCOPE = "api://AzureADTokenExchange/.default";

export type FabricAuthMode = "managed-identity" | "federated" | "client-secret";

export function fabricAuthMode(crossTenant: FabricCrossTenant | null | undefined): FabricAuthMode {
  if (!crossTenant) return "managed-identity";
  return crossTenant.clientSecret ? "client-secret" : "federated";
}

/** Seams for tests: the real identity classes, unless replaced. */
export interface CredentialDeps {
  managedIdentity: (clientId: string | undefined) => TokenCredential;
}

const realDeps: CredentialDeps = {
  managedIdentity: (clientId) => (clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential()),
};

/**
 * Build the cross-tenant credential, or undefined to keep the same-tenant default.
 * The returned credential asks Smartr's tenant (crossTenant.tenantId) for tokens as the multi-tenant
 * app (crossTenant.clientId).
 */
export function buildFabricCredential(
  crossTenant: FabricCrossTenant | null | undefined,
  deps: CredentialDeps = realDeps,
): TokenCredential | undefined {
  const mode = fabricAuthMode(crossTenant);
  if (mode === "managed-identity" || !crossTenant) return undefined;

  if (mode === "client-secret") {
    return new ClientSecretCredential(crossTenant.tenantId, crossTenant.clientId, crossTenant.clientSecret);
  }

  const mi = deps.managedIdentity(crossTenant.managedIdentityClientId || undefined);
  return new ClientAssertionCredential(crossTenant.tenantId, crossTenant.clientId, async () => {
    const token = await mi.getToken(TOKEN_EXCHANGE_SCOPE);
    if (!token?.token) throw new Error("Managed identity returned no token for the Fabric federated credential.");
    return token.token;
  });
}

// One credential per process: each instance holds its own token cache, so building one per query
// would fetch a fresh token every time. Keyed on the settings so tests that vary them still work.
let cachedKey: string | null = null;
let cachedCredential: TokenCredential | undefined;

function credentialFor(crossTenant: FabricCrossTenant | null | undefined): TokenCredential | undefined {
  const key = JSON.stringify(crossTenant ?? null);
  if (key !== cachedKey) {
    cachedKey = key;
    cachedCredential = buildFabricCredential(crossTenant);
  }
  return cachedCredential;
}

/** The pool options for the Fabric lakehouse share. Every Fabric query goes through this. */
export function fabricPool(config: Config): PoolOpts {
  const credential = credentialFor(config.fabric.crossTenant);
  return {
    server: config.fabric.endpoint,
    database: config.fabric.database,
    ...(credential ? { credential } : {}),
  };
}
