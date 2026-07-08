// Blank upload template, generated on demand rather than a static checked-in file — the office
// column is pre-filled from domain/offices.ts (OFFICES), so the next office-roster change (there
// have already been two this session) doesn't leave a stale template floating around to re-sync by
// hand. Same two sheets parse.ts expects.

import ExcelJS from "exceljs";
import { OFFICES } from "../../domain/offices.js";

export async function buildBlankTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const officeSheet = wb.addWorksheet("Office Targets");
  officeSheet.columns = [
    { header: "Effective Week (Mon)", key: "week", width: 20 },
    { header: "Office", key: "office", width: 18 },
    { header: "Leads", key: "leads", width: 10 },
    { header: "Applications", key: "applications", width: 14 },
    { header: "Referrals", key: "referrals", width: 12 },
    { header: "Sales", key: "sales", width: 10 },
  ];
  for (const o of OFFICES) {
    officeSheet.addRow({ week: "", office: o.name, leads: "", applications: "", referrals: "", sales: "" });
  }

  const revenueSheet = wb.addWorksheet("Revenue Target");
  revenueSheet.columns = [
    { header: "Effective Week (Mon)", key: "week", width: 20 },
    { header: "Weekly Revenue", key: "revenue", width: 16 },
  ];
  revenueSheet.addRow({ week: "", revenue: "" });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
