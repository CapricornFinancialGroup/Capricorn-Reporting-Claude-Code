import { loadConfig } from "./src/config.js";
import { run } from "./src/services/reporting/query.js";
import { officeOf, UNASSIGNED, OFFICES } from "./src/domain/offices.js";
const config = loadConfig();
const pool = { server: config.fabric.endpoint, database: config.fabric.database };
const ME = "denisa.ahmetaj@capricornfinancialmortgages.co.uk";

const dom: any[] = await run(pool, {
  text: `SELECT adv.Username AS adviser, neg.Username AS neg, neg.FullName AS negName, COUNT(*) AS n
         FROM dbo.mortgagecase c
         JOIN dbo.useraccount adv ON adv.UserAccountKey = c.PrimaryAdviserUserAccountKey
         LEFT JOIN dbo.useraccount neg ON neg.UserAccountKey = c.NegotiatorUserAccountKey
         WHERE COALESCE(c.DeletedYN,'N')<>'Y' AND c.LeadDate >= '2026-01-01'
         GROUP BY adv.Username, neg.Username, neg.FullName;`, params: [] });

// office -> total cases 2026, and cases on her domains
const total = new Map<string, number>(), onHers = new Map<string, number>();
const herDomains = new Set<string>();
for (const r of dom) if (r.adviser?.toLowerCase() === ME) { const d = String(r.neg ?? "").split("@")[1]?.toLowerCase(); if (d && d !== "capricornfinancialmortgages.co.uk") herDomains.add(d); }
for (const r of dom) {
  if (r.adviser?.toLowerCase() === ME) continue;
  const o = officeOf(r.adviser);
  total.set(o, (total.get(o) ?? 0) + r.n);
  const d = String(r.neg ?? "").split("@")[1]?.toLowerCase();
  if (d && herDomains.has(d)) onHers.set(o, (onHers.get(o) ?? 0) + r.n);
}
console.log("=== SHARE of each office's 2026 cases that use HER estate agencies ===");
for (const o of [...OFFICES.map(x=>x.name), UNASSIGNED]) {
  const t = total.get(o) ?? 0, h = onHers.get(o) ?? 0;
  console.log(`  ${o.padEnd(14)} ${String(h).padStart(6)} / ${String(t).padStart(6)}  = ${t ? ((h/t)*100).toFixed(1) : "-"}%`);
}

console.log("\n=== Her top individual negotiators — who else works with them, by office ===");
const herNegs = dom.filter((r) => r.adviser?.toLowerCase() === ME && r.neg).sort((a,b)=>b.n-a.n).slice(0,10);
for (const hn of herNegs) {
  const others = dom.filter((r) => r.neg === hn.neg && r.adviser?.toLowerCase() !== ME);
  const agg = new Map<string, number>();
  for (const r of others) agg.set(officeOf(r.adviser), (agg.get(officeOf(r.adviser)) ?? 0) + r.n);
  const top = [...agg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([o,n])=>`${o}:${n}`).join("  ");
  console.log(`  ${String(hn.negName).padEnd(24)} (hers:${hn.n})  ->  ${top || "(nobody else)"}`);
}

console.log("\n\n=== ALL Capricorn STAFF accounts not in the office mapping ===");
const staff: any[] = await run(pool, {
  text: `SELECT DISTINCT Username, FullName FROM dbo.useraccount
         WHERE LOWER(Username) LIKE '%@capricorn%' ORDER BY Username;`, params: [] });
const gaps = staff.filter((s) => officeOf(s.Username) === UNASSIGNED);
console.log(`${staff.length} Capricorn-domain accounts; ${gaps.length} unmapped:`);
for (const g of gaps) console.log(`  ${String(g.Username).padEnd(52)} ${g.FullName}`);
process.exit(0);
