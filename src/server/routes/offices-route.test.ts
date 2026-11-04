// The Offices admin routes, driven through the real Fastify app with blob storage and the lake stubbed.

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const saveOfficesBlob = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../services/offices/blob.js", () => ({
  saveOfficesBlob: (...args: unknown[]) => saveOfficesBlob(...args),
  loadOfficesBlob: vi.fn(async () => null),
}));

/** The lake: the activity list for GET, the login check for POST. Keyed off the query text. */
const lake = { active: [] as unknown[], logins: new Set<string>() };
vi.mock("../../services/reporting/query.js", () => ({
  run: vi.fn(async (_pool: unknown, q: { text: string; params: Array<{ name: string; value: unknown }> }) => {
    if (q.text.includes("WITH act AS")) return lake.active;
    const login = q.params.find((p) => p.name === "Login")?.value as string;
    return lake.logins.has(login) ? [{ username: login, fullName: "X" }] : [];
  }),
}));

import type { Config } from "../../config.js";
import { buildApp } from "../app.js";
import { UNASSIGNED, officeOf } from "../../domain/offices.js";
import { resetOfficesForTest } from "../../services/offices/store.js";

const ADMIN = "kyle@capricornfinancial.co.uk";
const NEW = "new.adviser@capricornfinancialmortgages.co.uk";

function testConfig(opts: { viewer?: string; storageAccount?: string } = {}): Config {
  return {
    port: 0,
    nodeEnv: "test",
    logLevel: "silent",
    fabric: { endpoint: "unused", database: "unused" },
    devUserEmail: opts.viewer ?? ADMIN,
    reporting: { kioskToken: "", refreshSeconds: 60, cycleSeconds: 20, timeZone: "Europe/London", pacingMode: "mtd", cacheTtlSeconds: 45, keyOnDataVersion: true, versionProbeSeconds: 600, versionedCacheMaxSeconds: 21600 },
    targets: { adminEmails: [ADMIN], storageAccount: opts.storageAccount ?? "teststorage" },
  } as Config;
}

const assign = (app: FastifyInstance, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/offices/assign", payload });

describe("Offices admin routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(testConfig()); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    resetOfficesForTest();
    saveOfficesBlob.mockReset();
    saveOfficesBlob.mockImplementation(async () => {});
    lake.active = [];
    lake.logins = new Set([NEW]);
  });

  it("places an unassigned adviser, persists it, and the board's officeOf sees it at once", async () => {
    expect(officeOf(NEW)).toBe(UNASSIGNED);
    const res = await assign(app, { login: NEW, office: "Mayfair", team: "Team Alex" });
    expect(res.statusCode).toBe(200);
    expect(officeOf(NEW)).toBe("Mayfair");
    const stored = saveOfficesBlob.mock.calls[0][1] as { assignments: Record<string, { office: string; team?: string; setBy: string }> };
    expect(stored.assignments[NEW]).toMatchObject({ office: "Mayfair", team: "Team Alex", setBy: ADMIN });
  });

  it("removing a placement falls back to the seed", async () => {
    lake.logins.add("crystal@capricornint.co.uk");
    await assign(app, { login: "crystal@capricornint.co.uk", office: "Singapore" });
    expect(officeOf("crystal@capricornint.co.uk")).toBe("Singapore");
    const res = await assign(app, { login: "crystal@capricornint.co.uk", office: null });
    expect(res.statusCode).toBe(200);
    expect(officeOf("crystal@capricornint.co.uk")).toBe("Hong Kong");
  });

  it("refuses a login with no Capricorn account, so a name can never be keyed by mistake", async () => {
    const res = await assign(app, { login: "simran@capricornfinancialmortgages.co.uk", office: "Mayfair" });
    expect(res.statusCode).toBe(400);
    expect(saveOfficesBlob).not.toHaveBeenCalled();
  });

  it("refuses an office that is not on the roster", async () => {
    const res = await assign(app, { login: NEW, office: "Dubai" });
    expect(res.statusCode).toBe(400);
    expect(officeOf(NEW)).toBe(UNASSIGNED);
  });

  it("refuses to place a shared team inbox", async () => {
    const res = await assign(app, { login: "cs@capricornfinancialmortgages.co.uk", office: "Hammersmith" });
    expect(res.statusCode).toBe(400);
  });

  it("changes nothing when storage fails, so the page never claims a placement a restart would lose", async () => {
    saveOfficesBlob.mockImplementation(async () => { throw new Error("403"); });
    const res = await assign(app, { login: NEW, office: "Mayfair" });
    expect(res.statusCode).toBe(500);
    expect(officeOf(NEW)).toBe(UNASSIGNED);
  });

  it("keeps both of two saves made together", async () => {
    lake.logins.add("second@capricornint.co.uk");
    const [a, b] = await Promise.all([
      assign(app, { login: NEW, office: "Mayfair" }),
      assign(app, { login: "second@capricornint.co.uk", office: "Shanghai" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const last = saveOfficesBlob.mock.calls.at(-1)![1] as { assignments: Record<string, unknown> };
    expect(Object.keys(last.assignments).sort()).toEqual([NEW, "second@capricornint.co.uk"]);
  });

  it("lists unassigned advisers first, merges a login's two names, and leaves out shared inboxes", async () => {
    lake.active = [
      { username: "simran.bains@capricornfinancialmortgages.co.uk", fullName: "Simran Bains", cases: 40, lastCase: "2026-11-03" },
      { username: NEW, fullName: "New Adviser", cases: 3, lastCase: "2026-11-01" },
      { username: "New.Adviser@CapricornFinancialMortgages.co.uk", fullName: "New Adviser ", cases: 2, lastCase: "2026-11-02" },
      { username: "cs@capricornfinancialmortgages.co.uk", fullName: "Client Services", cases: 900, lastCase: "2026-11-03" },
    ];
    const res = await app.inject({ method: "GET", url: "/api/offices" });
    expect(res.statusCode).toBe(200);
    const { advisers } = res.json() as { advisers: Array<{ login: string; office: string; cases: number; lastCase: string }> };
    expect(advisers.map((a) => a.login)).toEqual([NEW, "simran.bains@capricornfinancialmortgages.co.uk"]);
    expect(advisers[0]).toMatchObject({ office: UNASSIGNED, cases: 5, lastCase: "2026-11-02" });
  });
});

describe("Offices admin routes: who may use them", () => {
  it("refuses a signed-in viewer who is not an admin", async () => {
    const app = await buildApp(testConfig({ viewer: "adviser@capricornfinancialmortgages.co.uk" }));
    expect((await app.inject({ method: "GET", url: "/api/offices" })).statusCode).toBe(403);
    expect((await assign(app, { login: NEW, office: "Mayfair" })).statusCode).toBe(403);
    await app.close();
  });

  it("refuses to save when storage is not configured, rather than holding it in memory only", async () => {
    const app = await buildApp(testConfig({ storageAccount: "" }));
    expect((await assign(app, { login: NEW, office: "Mayfair" })).statusCode).toBe(503);
    await app.close();
  });
});
