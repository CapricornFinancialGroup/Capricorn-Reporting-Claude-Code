import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };
for (const t of ["useraccount", "mortgagecase"]) {
  const cols: any[] = await run(pool, {
    text: `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION;`,
    params: [],
  });
  console.log(`\n=== ${t} (${cols.length} cols) ===`);
  console.log(cols.map((c) => c.COLUMN_NAME).join(", "));
}
const tables: any[] = await run(pool, { text: `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;`, params: [] });
console.log("\n=== TABLES ===");
console.log(tables.map((t) => t.TABLE_NAME).join(", "));
process.exit(0);
