import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };
for (const t of ["mortgagecaseuser", "userrole", "organisation"]) {
  const cols: any[] = await run(pool, { text: `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION;`, params: [] });
  console.log(`${t}: ${cols.map((c) => c.COLUMN_NAME).join(", ")}`);
}
process.exit(0);
