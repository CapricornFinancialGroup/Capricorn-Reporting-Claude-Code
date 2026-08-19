import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
import { officeOf, UNASSIGNED, ADVISER_OFFICE } from "./src/domain/offices.js";

const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };

console.log("=== ACCOUNTS MATCHING 'ahmetaj' or 'denisa' ===");
const accts: any[] = await run(pool, {
  text: `SELECT UserAccountKey, Username, FullName FROM dbo.useraccount
         WHERE LOWER(FullName) LIKE '%denisa%' OR LOWER(FullName) LIKE '%ahmetaj%'
            OR LOWER(Username) LIKE '%denisa%' OR LOWER(Username) LIKE '%ahmetaj%';`,
  params: [],
});
console.table(accts);

console.log("\n=== ALL ADVISERS WITH CASE ACTIVITY IN LAST 180 DAYS, WITH OFFICE ===");
const rows: any[] = await run(pool, {
  text: `SELECT adv.Username AS username, adv.FullName AS fullName,
                COUNT(*) AS cases, MIN(f.LeadDate) AS firstLead, MAX(f.LeadDate) AS lastLead
         FROM dbo.mortgagecase f
         LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
         WHERE COALESCE(f.DeletedYN,'N') <> 'Y'
           AND f.LeadDate >= DATEADD(day, -180, CAST(GETDATE() AS date))
         GROUP BY adv.Username, adv.FullName
         ORDER BY COUNT(*) DESC;`,
  params: [],
});
const unmapped = rows.filter((r) => officeOf(r.username) === UNASSIGNED);
console.log(`total advisers active: ${rows.length}; UNMAPPED: ${unmapped.length}`);
console.table(unmapped.map((r) => ({ username: r.username, fullName: r.fullName, cases: r.cases, firstLead: String(r.firstLead).slice(0,10), lastLead: String(r.lastLead).slice(0,10) })));
process.exit(0);
