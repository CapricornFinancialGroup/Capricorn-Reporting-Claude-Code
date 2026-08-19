import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
import { officeOf } from "./src/domain/offices.js";
const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };
const KEY = 3111467;

console.log("=== 1. Her account record ===");
console.table(await run(pool, { text: `SELECT UserAccountKey, OrganisationKey, _OrgID, UserID, Username, FullName, _etl_created FROM dbo.useraccount WHERE UserAccountKey=${KEY};`, params: [] }));

console.log("\n=== 2. Accounts with neighbouring UserAccountKey + their office ===");
const nb: any[] = await run(pool, { text: `SELECT UserAccountKey, Username, FullName, _etl_created FROM dbo.useraccount WHERE UserAccountKey BETWEEN ${KEY-30} AND ${KEY+30} ORDER BY UserAccountKey;`, params: [] });
console.table(nb.map((r) => ({ key: r.UserAccountKey, username: r.Username, name: r.FullName, office: officeOf(r.Username), created: String(r._etl_created).slice(0,16) })));

console.log("\n=== 3. Other users on HER cases (mortgagecaseuser via GlobalCaseID) ===");
const mcu: any[] = await run(pool, {
  text: `SELECT u.Username, u.FullName, mcu.CaseRole, COUNT(*) AS n
         FROM dbo.mortgagecase c
         JOIN dbo.mortgagecaseuser mcu ON mcu.GlobalCaseID = c.GlobalCaseID
         JOIN dbo.useraccount u ON u.UserAccountKey = mcu.UserAccountKey
         WHERE c.PrimaryAdviserUserAccountKey = ${KEY} AND COALESCE(c.DeletedYN,'N') <> 'Y' AND u.UserAccountKey <> ${KEY}
         GROUP BY u.Username, u.FullName, mcu.CaseRole ORDER BY COUNT(*) DESC;`, params: [] });
console.table(mcu.map((r) => ({ username: r.Username, name: r.FullName, role: r.CaseRole, n: r.n, office: officeOf(r.Username) })));

console.log("\n=== 4. Referring / negotiator / referral-by on her cases ===");
for (const col of ["ReferringAdviserUserAccountKey", "NegotiatorUserAccountKey", "ProtectionReferralByUserAccountKey"]) {
  const r: any[] = await run(pool, {
    text: `SELECT u.Username, u.FullName, COUNT(*) AS n FROM dbo.mortgagecase c
           JOIN dbo.useraccount u ON u.UserAccountKey = c.${col}
           WHERE c.PrimaryAdviserUserAccountKey=${KEY} AND COALESCE(c.DeletedYN,'N')<>'Y' AND c.${col} <> ${KEY}
           GROUP BY u.Username, u.FullName ORDER BY COUNT(*) DESC;`, params: [] });
  console.log(`-- ${col}:`);
  console.table(r.map((x) => ({ username: x.Username, name: x.FullName, n: x.n, office: officeOf(x.Username) })));
}

console.log("\n=== 5. Where SHE is referrer/negotiator on someone else's case ===");
const asRef: any[] = await run(pool, {
  text: `SELECT u.Username, u.FullName, COUNT(*) AS n FROM dbo.mortgagecase c
         JOIN dbo.useraccount u ON u.UserAccountKey = c.PrimaryAdviserUserAccountKey
         WHERE (c.ReferringAdviserUserAccountKey=${KEY} OR c.NegotiatorUserAccountKey=${KEY} OR c.ProtectionReferralByUserAccountKey=${KEY})
           AND COALESCE(c.DeletedYN,'N')<>'Y' AND c.PrimaryAdviserUserAccountKey <> ${KEY}
         GROUP BY u.Username, u.FullName ORDER BY COUNT(*) DESC;`, params: [] });
console.table(asRef.map((x) => ({ username: x.Username, name: x.FullName, n: x.n, office: officeOf(x.Username) })));

console.log("\n=== 6. Her cases on mortgagecaseuser roles (all roles incl. hers) ===");
const roles: any[] = await run(pool, {
  text: `SELECT mcu.CaseRole, COUNT(*) AS n FROM dbo.mortgagecaseuser mcu WHERE mcu.UserAccountKey=${KEY} GROUP BY mcu.CaseRole;`, params: [] });
console.table(roles);
process.exit(0);
