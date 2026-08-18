// The page registry — nav and kiosk rotation both read from this array.

import type { ComponentType } from "react";
import type { PageProps } from "./common.js";
import { DailyRunChase } from "./DailyRunChase.js";
import { OfficeRunChase } from "./OfficeRunChase.js";
import { AdviserLeague } from "./AdviserLeague.js";
import { FunnelHealth } from "./FunnelHealth.js";
import { MarketMomentum } from "./MarketMomentum.js";
import { Reconciliation } from "./Reconciliation.js";
import { Targets } from "./Targets.js";
import { Glossary } from "./Glossary.js";

export interface PageDef {
  id: string;
  label: string;
  Component: ComponentType<PageProps>;
  /** Hidden from BOTH the kiosk/wall rotation and the dashboard nav unless the signed-in viewer
   *  is a Targets admin (meta.isTargetsAdmin) — one flag drives both exclusions, so a future
   *  admin-only page can't accidentally end up on the office wall TVs by adding it here and
   *  forgetting a second list. */
  adminOnly?: boolean;
  /** Kept OUT of the wall/kiosk rotation but visible to every signed-in viewer. Distinct from
   *  `adminOnly`: Reconciliation is for anyone who wants to know why a figure differs from their own
   *  report — the CFO first of all — but a dense audit table has no business on an office TV.
   *
   *  Funnel Health joined it 2026-08-18 at Kyle's request ("Please remove this from the Wall mode
   *  (but keep for us in the back end)"). It is the one screen that runs MONTH to date while the
   *  wall runs the current week, and on an unattended TV that difference is invisible — 722 leads
   *  next to 43 read as two broken screens rather than two windows (2026-08-10). Off the wall, in
   *  the dashboard, where its period label can be read. */
  kioskExclude?: boolean;
}

export const PAGES: PageDef[] = [
  { id: "daily", label: "Daily Run Chase", Component: DailyRunChase },
  { id: "offices", label: "Office Run Chase", Component: OfficeRunChase },
  { id: "advisers", label: "Adviser League", Component: AdviserLeague },
  { id: "funnel", label: "Funnel Health", Component: FunnelHealth, kioskExclude: true },
  { id: "momentum", label: "Market Momentum", Component: MarketMomentum },
  { id: "reconciliation", label: "Reconciliation", Component: Reconciliation, kioskExclude: true },
  { id: "targets", label: "Targets", Component: Targets, adminOnly: true },
  { id: "glossary", label: "Glossary", Component: Glossary, adminOnly: true },
];

// The wall/kiosk rotation is for the office TVs — an upload form, an internal glossary or a
// reconciliation audit has no business there.
export const KIOSK_PAGE_IDS = PAGES.filter((p) => !p.adminOnly && !p.kioskExclude).map((p) => p.id);
