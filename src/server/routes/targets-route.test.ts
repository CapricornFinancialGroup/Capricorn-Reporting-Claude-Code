// Integration test for the targets upload routes — drives the real Fastify app via .inject() with
// the Azure blob write stubbed, so it exercises multipart handling, admin gating, parse, merge and
// in-memory activation end-to-end without touching storage (a real write would persist current.json
// and change live targets on the next hydrate).

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("../../services/targets/blob.js", () => ({
  uploadTargetsBlob: vi.fn(async () => {}),
  hydrateFromStorage: vi.fn(async () => null),
}));

import type { Config } from "../../config.js";
import { buildApp } from "../app.js";
import { getWrittenWeeklyTargets, resetTargetsForTest } from "../../services/targets/store.js";

const ADMIN = "arman@capricornfinancial.co.uk";

function testConfig(overrides: Partial<Config["targets"]> = {}): Config {
  return {
    port: 0,
    nodeEnv: "test",
    logLevel: "silent",
    fabric: { endpoint: "unused", database: "unused" },
    devUserEmail: ADMIN, // dev-auth: treated as the viewer (no Easy Auth headers in a test)
    reporting: { kioskToken: "", refreshSeconds: 60, cycleSeconds: 20, timeZone: "Europe/London", pacingMode: "mtd", cacheTtlSeconds: 45 },
    targets: { adminEmails: [ADMIN], storageAccount: "teststorage", ...overrides },
  };
}

/** One weekly-written workbook, faithful to Capricorn's real files: sheet name with the stray space,
 *  per-adviser rows, £/zero-width-space-contaminated numeric strings. */
async function writtenWorkbook(sheetName: string, week: string, rows: Array<[string, unknown]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow(["Adviser", week]);
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Assemble a multipart/form-data body (text fields + file parts) as a single Buffer. */
function multipart(fields: Record<string, string>, files: Record<string, Buffer>): { body: Buffer; contentType: string } {
  const boundary = "----testboundary1234567890";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const [name, buf] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(buf);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const WEEK = "2026-07-04";

async function postWritten(app: FastifyInstance, config: Config, opts: { week?: string; mortgage?: Buffer; insurance?: Buffer } = {}) {
  const mortgage = opts.mortgage ?? (await writtenWorkbook("Mortgage_Weekly_Written _Target", WEEK, [["Albano Toska", 10000], ["Alex Smith", "£8,000​"]]));
  const insurance = opts.insurance ?? (await writtenWorkbook("Insurance_Weekly_Written _Ta", WEEK, [["Albano Toska", 250], ["Alex Smith", "£250​"]]));
  const { body, contentType } = multipart({ week: opts.week ?? WEEK }, { mortgage, insurance });
  return app.inject({ method: "POST", url: "/api/targets/import-written", payload: body, headers: { "content-type": contentType } });
}

describe("POST /api/targets/import-written (end-to-end via inject, blob stubbed)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(testConfig()); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => resetTargetsForTest());

  it("parses both files, activates the written targets, and returns ok", async () => {
    const res = await postWritten(app, testConfig());
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    // 10000 + 8000 mortgage, 250 + 250 insurance — the £/zero-width string cleaned like the real files.
    expect(getWrittenWeeklyTargets()).toEqual({ mortgage: 18000, insurance: 500 });
  });

  it("rejects a week the workbook has no data for (422, no silent zero)", async () => {
    const res = await postWritten(app, testConfig(), { week: "2026-07-18" });
    expect(res.statusCode).toBe(422);
    expect(res.json().hardErrors.join(" ")).toContain("2026-07-18");
  });
});

describe("POST /api/targets/import-written — admin gating", () => {
  beforeEach(() => resetTargetsForTest());

  it("403s a non-admin viewer", async () => {
    const app = await buildApp(testConfig());
    // Non-admin identity via the Easy Auth principal header (overrides dev-auth).
    const mortgage = await writtenWorkbook("Mortgage_Weekly_Written _Target", WEEK, [["A", 1]]);
    const insurance = await writtenWorkbook("Insurance_Weekly_Written _Ta", WEEK, [["A", 1]]);
    const { body, contentType } = multipart({ week: WEEK }, { mortgage, insurance });
    const res = await app.inject({
      method: "POST",
      url: "/api/targets/import-written",
      payload: body,
      headers: { "content-type": contentType, "x-ms-client-principal-name": "someone.else@capricornfinancial.co.uk" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
