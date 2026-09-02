// Ad-hoc read-only query runner for investigating the lake from a dev machine.
//   npx tsx scripts/adhoc-query.mts "SELECT TOP 5 * FROM dbo.protectioncase"
// Uses the same pool/auth as the server (azure-active-directory-default), so it needs an `az login`
// identity with reader on the Fabric warehouse. Read-only by convention — nothing here writes.

import { getPool } from "../src/services/reporting/sql-pool.js";
import { loadConfig } from "../src/config.js";

const text = process.argv.slice(2).join(" ");
if (!text.trim()) {
  console.error("usage: npx tsx scripts/adhoc-query.mts \"<sql>\"");
  process.exit(2);
}

const config = loadConfig();
const pool = await getPool({ server: config.fabric.endpoint, database: config.fabric.database });
const result = await pool.request().query(text);
for (const rs of result.recordsets ?? []) {
  console.log(JSON.stringify(rs, null, 1));
}
process.exit(0);
