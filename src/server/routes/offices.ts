// Offices admin page: Capricorn place their own advisers in an office.
//
//   GET  /api/offices          every adviser active in the last WINDOW_DAYS, with the office the board
//                              puts them in and where that came from. Unassigned first.
//   POST /api/offices/assign   { login, office | null, team? } — place, move, or (office null) remove a
//                              placement so the seed in domain/offices.ts applies again.
//
// Both are behind Easy Auth and the same isTargetsAdmin gate as the Targets uploads: this changes what
// every office's figures add up to, so it is dashboard-only and admin-only.

import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { OFFICES, UNASSIGNED, getOfficeOverrides, isOfficeName, isSharedAccount, officeOf, seedOfficeOf } from "../../domain/offices.js";
import { isTargetsAdmin, resolveCsm } from "../../services/auth.js";
import { logger } from "../../services/logger.js";
import { activeAdvisers, capricornLogin, type ActiveAdviser } from "../../services/offices/queries.js";
import { getLastOfficeChange, placeAdviser } from "../../services/offices/store.js";
import { run } from "../../services/reporting/query.js";
import { shiftDays } from "../../services/reporting/trends.js";
import { tzToday } from "../../services/reporting/pace.js";

/** Long enough to catch an adviser who writes a case a month, short enough to leave leavers off. */
export const WINDOW_DAYS = 120;
const TEAM_MAX = 60;

export interface OfficeAdviserRow {
  login: string;
  name: string | null;
  cases: number;
  lastCase: string | null;
  office: string;
  /** Where the board would put them with no placement: the email-ruled list, or Unassigned. */
  seedOffice: string;
  placement: { office: string; team?: string; setBy: string; setAt: string } | null;
}

export function registerOfficesRoutes(app: FastifyInstance, config: Config): void {
  const pool = { server: config.fabric.endpoint, database: config.fabric.database };

  app.get("/api/offices", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) return reply.code(401).send({ error: "Not authenticated." });
    if (!isTargetsAdmin(viewer.email, config.targets.adminEmails)) return reply.code(403).send({ error: "Not authorized." });

    const since = shiftDays(tzToday(new Date(), config.reporting.timeZone), -WINDOW_DAYS);
    let active: ActiveAdviser[];
    try {
      active = await run<ActiveAdviser>(pool, activeAdvisers(since));
    } catch (err) {
      logger.error("Offices adviser list failed", { err: String(err) });
      return reply.code(500).send({ error: "Could not read advisers from the lake." });
    }

    const overrides = getOfficeOverrides();
    const rows = new Map<string, OfficeAdviserRow>();
    for (const a of active) {
      if (!a.username || isSharedAccount(a.username)) continue;
      const login = a.username.trim().toLowerCase();
      const prev = rows.get(login);
      // One login can carry two display names in the lake; keep one row and add their cases together.
      rows.set(login, {
        login,
        name: prev?.name ?? a.fullName?.trim() ?? null,
        cases: (prev?.cases ?? 0) + Number(a.cases),
        lastCase: [prev?.lastCase, a.lastCase].filter(Boolean).sort().pop() ?? null,
        office: officeOf(login),
        seedOffice: seedOfficeOf(login),
        placement: overrides[login] ?? null,
      });
    }
    // A placement stays visible (and removable) even after its adviser goes quiet.
    for (const [login, placement] of Object.entries(overrides)) {
      if (!rows.has(login)) rows.set(login, { login, name: null, cases: 0, lastCase: null, office: officeOf(login), seedOffice: seedOfficeOf(login), placement });
    }

    const advisers = [...rows.values()].sort(
      (a, b) => Number(b.office === UNASSIGNED) - Number(a.office === UNASSIGNED) || b.cases - a.cases || a.login.localeCompare(b.login),
    );
    return reply.send({
      offices: OFFICES.map((o) => o.name),
      windowDays: WINDOW_DAYS,
      since,
      storageConfigured: Boolean(config.targets.storageAccount),
      lastChange: getLastOfficeChange(),
      advisers,
    });
  });

  app.post<{ Body: { login?: unknown; office?: unknown; team?: unknown } }>("/api/offices/assign", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) return reply.code(401).send({ error: "Not authenticated." });
    if (!isTargetsAdmin(viewer.email, config.targets.adminEmails)) return reply.code(403).send({ error: "Not authorized." });
    if (!config.targets.storageAccount) {
      // Fail closed: a placement held only in memory would vanish on the next restart, silently.
      return reply.code(503).send({ error: "Storage is not configured, so a placement could not be kept." });
    }

    const body = request.body ?? {};
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    const office = body.office === null ? null : typeof body.office === "string" ? body.office.trim() : undefined;
    const team = typeof body.team === "string" ? body.team.trim().slice(0, TEAM_MAX) : undefined;
    if (!login) return reply.code(400).send({ error: "A login is required." });
    if (office === undefined) return reply.code(400).send({ error: "An office (or null, to remove the placement) is required." });
    if (office !== null && !isOfficeName(office)) {
      return reply.code(400).send({ error: `"${office}" is not an office. Choose one of: ${OFFICES.map((o) => o.name).join(", ")}.` });
    }
    if (isSharedAccount(login)) return reply.code(400).send({ error: "That login is a shared team inbox, not an adviser." });
    if (office === null && !getOfficeOverrides()[login]) return reply.code(400).send({ error: "That adviser has no placement to remove." });

    if (office !== null) {
      let found: unknown[];
      try {
        found = await run(pool, capricornLogin(login));
      } catch (err) {
        logger.error("Offices login check failed", { err: String(err) });
        return reply.code(500).send({ error: "Could not check the login against the lake." });
      }
      if (found.length === 0) return reply.code(400).send({ error: `No Capricorn account has the login ${login}.` });
    }

    try {
      await placeAdviser(config.targets.storageAccount, { login, office, team, by: viewer.email });
    } catch (err) {
      logger.error("Office placement could not be saved", { login, err: String(err) });
      return reply.code(500).send({ error: "The placement could not be saved. Nothing has changed." });
    }
    return reply.send({ ok: true, login, office: officeOf(login) });
  });
}
