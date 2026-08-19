import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
import { officeOf, UNASSIGNED } from "./src/domain/offices.js";
const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };
const KEY = 3111467;

// Her negotiator domains (estate agencies)
const hers: any[] = await run(pool, {
  text: `SELECT DISTINCT c.NegotiatorUserAccountKey AS k FROM dbo.mortgagecase c
         WHERE c.PrimaryAdviserUserAccountKey=${KEY} AND COALESCE(c.DeletedYN,'N')<>'Y' AND c.NegotiatorUserAccountKey IS NOT NULL;`, params: [] });
const herKeys = hers.map((r) => r.k).filter((k) => k != null);
console.log(`Her distinct negotiators: ${herKeys.length}`);

console.log("\n=== Which office's advisers use the SAME negotiator accounts? ===");
const shared: any[] = await run(pool, {
  text: `SELECT u.Username, u.FullName, COUNT(*) AS sharedCases, COUNT(DISTINCT c.NegotiatorUserAccountKey) AS sharedNegs
         FROM dbo.mortgagecase c
         JOIN dbo.useraccount u ON u.UserAccountKey = c.PrimaryAdviserUserAccountKey
         WHERE c.NegotiatorUserAccountKey IN (${herKeys.join(",")})
           AND COALESCE(c.DeletedYN,'N')<>'Y' AND c.PrimaryAdviserUserAccountKey <> ${KEY}
         GROUP BY u.Username, u.FullName ORDER BY COUNT(*) DESC;`, params: [] });
const byOffice = new Map<string, { cases: number; advisers: string[] }>();
for (const r of shared) {
  const o = officeOf(r.Username);
  const e = byOffice.get(o) ?? { cases: 0, advisers: [] };
  e.cases += r.sharedCases; e.advisers.push(`${r.FullName}(${r.sharedCases})`);
  byOffice.set(o, e);
}
for (const [o, e] of [...byOffice.entries()].sort((a,b)=>b[1].cases-a[1].cases)) {
  console.log(`\n${o}: ${e.cases} shared cases`);
  console.log("   " + e.advisers.slice(0, 12).join(", "));
}

console.log("\n\n=== Same, by NEGOTIATOR EMAIL DOMAIN (estate agency) ===");
const dom: any[] = await run(pool, {
  text: `SELECT adv.Username AS adviser, neg.Username AS neg, COUNT(*) AS n
         FROM dbo.mortgagecase c
         JOIN dbo.useraccount adv ON adv.UserAccountKey = c.PrimaryAdviserUserAccountKey
         JOIN dbo.useraccount neg ON neg.UserAccountKey = c.NegotiatorUserAccountKey
         WHERE COALESCE(c.DeletedYN,'N')<>'Y' AND c.LeadDate >= '2026-01-01'
         GROUP BY adv.Username, neg.Username;`, params: [] });
const herDomains = new Set<string>();
for (const r of dom) if (r.adviser?.toLowerCase() === "denisa.ahmetaj@capricornfinancialmortgages.co.uk") {
  const d = String(r.neg).split("@")[1]?.toLowerCase(); if (d) herDomains.add(d);
}
console.log("Her agency domains:", [...herDomains].join(", "));
const offAgg = new Map<string, number>();
for (const r of dom) {
  const d = String(r.neg).split("@")[1]?.toLowerCase();
  if (!d || !herDomains.has(d)) continue;
  if (r.adviser?.toLowerCase() === "denisa.ahmetaj@capricornfinancialmortgages.co.uk") continue;
  const o = officeOf(r.adviser);
  offAgg.set(o, (offAgg.get(o) ?? 0) + r.n);
}
console.log("\nCases on HER agency domains, by office:");
for (const [o, n] of [...offAgg.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${o.padEnd(14)} ${n}`);
process.exit(0);
