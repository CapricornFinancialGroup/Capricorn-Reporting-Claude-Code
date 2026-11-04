// The office placements made on the Offices admin page: hydrate at startup, and apply a change by
// writing storage first and only then swapping the in-memory layer that officeOf() reads.

import { getOfficeOverrides, setOfficeOverrides, type OfficeAssignment } from "../../domain/offices.js";
import { logger } from "../logger.js";
import { clearCache } from "../reporting/cache.js";
import { loadOfficesBlob, saveOfficesBlob } from "./blob.js";

let lastChange: { updatedBy: string; updatedAt: string } | null = null;

/** Saves run one at a time. Each builds the next state from the current one, so two admins saving
 *  close together must not both start from the same snapshot and have the second erase the first. */
let queue: Promise<unknown> = Promise.resolve();

export function getLastOfficeChange(): { updatedBy: string; updatedAt: string } | null {
  return lastChange;
}

/** Best-effort startup load. Unconfigured or unreachable storage leaves the seed mapping in force,
 *  which is exactly the board as it was before this page existed — never blocks or crashes startup. */
export async function hydrateOffices(storageAccount: string): Promise<void> {
  if (!storageAccount) return;
  try {
    const stored = await loadOfficesBlob(storageAccount);
    if (!stored) return;
    setOfficeOverrides(stored.assignments);
    lastChange = { updatedBy: stored.updatedBy, updatedAt: stored.updatedAt };
    logger.info("Hydrated office placements from storage", { count: Object.keys(stored.assignments).length, updatedAt: stored.updatedAt });
  } catch (err) {
    logger.warn("Failed to hydrate office placements — using the seed mapping only", { err: String(err) });
  }
}

/** Place `login` in `office`, or with `office` null remove its placement so the seed applies again.
 *  Persisted before it is activated; the dataset cache is cleared so the board shows it on next read. */
export function placeAdviser(
  storageAccount: string,
  change: { login: string; office: string | null; team?: string; by: string; at?: string },
): Promise<void> {
  const run = async () => {
    const key = change.login.trim().toLowerCase();
    const at = change.at ?? new Date().toISOString();
    const next: Record<string, OfficeAssignment> = { ...getOfficeOverrides() };
    if (change.office === null) delete next[key];
    else next[key] = { office: change.office, ...(change.team ? { team: change.team } : {}), setBy: change.by, setAt: at };

    await saveOfficesBlob(storageAccount, { assignments: next, updatedBy: change.by, updatedAt: at });
    setOfficeOverrides(next);
    lastChange = { updatedBy: change.by, updatedAt: at };
    clearCache();
    logger.info("Office placement saved", { login: key, office: change.office, by: change.by });
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export function resetOfficesForTest(): void {
  setOfficeOverrides({});
  lastChange = null;
  queue = Promise.resolve();
}
