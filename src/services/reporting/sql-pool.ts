// Shared mssql connection-pool factory for the reporting layer.
//
// Extracts the pool pattern duplicated in SqlCommitmentStore (sql-commitment-store.ts) and
// EngUsageSource (usage-sources.ts): managed-identity auth via tedious
// `azure-active-directory-default` (DefaultAzureCredential → the App Service system-assigned MI,
// granted db_datareader), a 30s connect timeout to ride out cold-start MI-token + TCP setup, and a
// cached promise that resets on failure so the next call retries.
//
// Pools are cached per server/database so the reporting endpoints (SmartrCS) and the revenue
// endpoints (Fabric GAGold) each reuse one pool across requests rather than reconnecting.

import sql from "mssql";

export interface PoolOpts {
  /** Logical server FQDN, e.g. smt-sql-smartrcs-prod.database.windows.net (or a Fabric endpoint). */
  server: string;
  database: string;
  /** User-assigned MI client id; empty/undefined = system-assigned MI / DefaultAzureCredential. */
  clientId?: string;
}

const pools = new Map<string, Promise<sql.ConnectionPool>>();

/** Get (or lazily create) the cached pool for a server/database. */
export function getPool(opts: PoolOpts): Promise<sql.ConnectionPool> {
  const key = `${opts.server}/${opts.database}`;
  const existing = pools.get(key);
  if (existing) return existing;

  const pool = new sql.ConnectionPool({
    server: opts.server,
    database: opts.database,
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: "azure-active-directory-default",
      options: opts.clientId ? { clientId: opts.clientId } : {},
    },
  });
  const p = pool.connect().catch((err) => {
    pools.delete(key);
    throw err;
  });
  pools.set(key, p);
  return p;
}

/** Drop one cached pool (e.g. after a dropped connection) so the next getPool reconnects. */
export function evictPool(opts: PoolOpts): void {
  const key = `${opts.server}/${opts.database}`;
  const p = pools.get(key);
  pools.delete(key);
  // Best-effort close; ignore errors (the connection may already be dead).
  p?.then((c) => c.close()).catch(() => {});
}

/** Close and forget all pools (used by tests / graceful shutdown). */
export async function closeAllPools(): Promise<void> {
  const entries = [...pools.values()];
  pools.clear();
  await Promise.allSettled(entries.map(async (p) => (await p).close()));
}
