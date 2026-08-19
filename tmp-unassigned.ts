import { loadConfig } from "./src/config.js";
import { getDataset } from "./src/services/reporting/datasets.js";
import { EMPTY_FILTERS } from "./src/services/reporting/filters.js";

const config = loadConfig();
const data: any = await getDataset("office-run-chase", config, EMPTY_FILTERS as any);
const offices = data.offices ?? data.displayOrder ?? [];
console.log("=== OFFICE TILES RETURNED ===");
for (const o of offices) {
  console.log(`${o.office.padEnd(14)} active=${o.active} hasTargets=${o.hasTargets} pct=${o.pct} kpis=${JSON.stringify(o.kpis?.map((k:any)=>[k.key,k.actual,k.target]))}`);
}
const un = offices.find((o: any) => o.office === "Unassigned");
console.log("\n=== UNASSIGNED MEMBERS ===");
console.log(JSON.stringify(un?.members ?? null, null, 2));
process.exit(0);
