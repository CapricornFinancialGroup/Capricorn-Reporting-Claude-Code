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
}

export const PAGES: PageDef[] = [
  { id: "daily", label: "Daily Run Chase", Component: DailyRunChase },
  { id: "offices", label: "Office Run Chase", Component: OfficeRunChase },
  { id: "advisers", label: "Adviser League", Component: AdviserLeague },
  { id: "funnel", label: "Funnel Health", Component: FunnelHealth },
  { id: "momentum", label: "Market Momentum", Component: MarketMomentum },
  { id: "targets", label: "Targets", Component: Targets, adminOnly: true },
  { id: "glossary", label: "Glossary", Component: Glossary, adminOnly: true },
];

// The wall/kiosk rotation is for the office TVs — an upload form or an internal glossary has no
// business there.
export const KIOSK_PAGE_IDS = PAGES.filter((p) => !p.adminOnly).map((p) => p.id);
