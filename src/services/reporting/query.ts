// Tiny query-execution helper shared by the reporting query modules.
//
// Query builders stay PURE — they return `{ text, params }` so the SQL and its bound parameters can
// be unit-tested without a database (the pattern established by buildUsageLookup in
// usage-sources.ts). This module is the only place that touches the live pool: it binds the typed
// params and runs the text.

import sql from "mssql";
import { getPool, evictPool, type PoolOpts } from "./sql-pool.js";

/** A bound parameter with an explicit SQL kind, so builders need not import mssql. */
export interface SqlParam {
  name: string;
  /** For `datetime`, pass an ISO-8601 UTC string (e.g. new Date().toISOString()). */
  value: string | number | null;
  kind: "date" | "datetime" | "nvarchar" | "int";
}

export interface BuiltQuery {
  text: string;
  params: SqlParam[];
}

function bind(request: sql.Request, params: SqlParam[]): sql.Request {
  for (const p of params) {
    switch (p.kind) {
      case "date":
        request.input(p.name, sql.Date, p.value);
        break;
      case "datetime":
        // ISO-8601 string → DateTime2; mssql parses the string to a JS Date for the TDS param.
        request.input(p.name, sql.DateTime2, p.value == null ? null : new Date(p.value as string));
        break;
      case "int":
        request.input(p.name, sql.Int, p.value);
        break;
      default:
        request.input(p.name, sql.NVarChar, p.value);
    }
  }
  return request;
}

// Transient connection failures — chiefly the operational DB being serverless (GP_S, auto-pause):
// the first hit after a pause drops the socket while the DB resumes. We evict the dead pool and
// retry so the resume is transparent instead of surfacing "no data".
const TRANSIENT = /ECONNRESET|ESOCKET|ETIMEOUT|ETIMEDOUT|socket hang up|Connection lost|ConnectionError|Failed to connect|not currently available/i;

/**
 * Run a pure-built query against the given pool and return the typed recordset.
 * Retries transient connection errors (default 2) to ride out a serverless-DB resume. Pass
 * `{ retries: 0 }` for sources that fail fast by design (e.g. the unreachable Fabric endpoint) so
 * they don't add latency.
 */
export async function run<T>(pool: PoolOpts, q: BuiltQuery, opts: { retries?: number } = {}): Promise<T[]> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const connection = await getPool(pool);
      const result = await bind(connection.request(), q.params).query<T>(q.text);
      return result.recordset;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message ?? err);
      if (attempt < retries && TRANSIENT.test(msg)) {
        evictPool(pool); // drop the dead/half-open pool so the next attempt reconnects
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
