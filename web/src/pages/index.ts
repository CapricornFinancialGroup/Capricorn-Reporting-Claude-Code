// The page registry — nav and kiosk rotation both read from this array.

import type { ComponentType } from "react";
import type { PageProps } from "./common.js";
import { DailyRunChase } from "./DailyRunChase.js";
import { OfficeRunChase } from "./OfficeRunChase.js";
import { AdviserLeague } from "./AdviserLeague.js";
import { FunnelHealth } from "./FunnelHealth.js";
import { MarketMomentum } from "./MarketMomentum.js";
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
  /** Hidden from the wall/kiosk rotation ONLY — still in the dashboard nav for every viewer.
   *  Distinct from adminOnly, which is an authorization gate: this one is editorial, for a page
   *  that earns its place in the browser but not on an unattended office TV. Like adminOnly, it
   *  is enforced against an explicit `?pages=` override too, so "not on the wall" means not on
   *  the wall by any URL. */
  wallExcluded?: boolean;
}

export const PAGES: PageDef[] = [
  { id: "daily", label: "Daily Run Chase", Component: DailyRunChase },
  { id: "offices", label: "Office Run Chase", Component: OfficeRunChase },
  { id: "advisers", label: "Adviser League", Component: AdviserLeague },
  { id: "funnel", label: "Funnel Health", Component: FunnelHealth, wallExcluded: true },
  { id: "momentum", label: "Market Momentum", Component: MarketMomentum },
  { id: "targets", label: "Targets", Component: Targets, adminOnly: true },
  { id: "glossary", label: "Glossary", Component: Glossary, adminOnly: true },
];

// The wall/kiosk rotation is for the office TVs — an upload form or an internal glossary has no
// business there, and neither does a page flagged wallExcluded.
export const onWall = (p: PageDef): boolean => !p.adminOnly && !p.wallExcluded;

export const KIOSK_PAGE_IDS = PAGES.filter(onWall).map((p) => p.id);
