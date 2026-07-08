// The page registry — nav and kiosk rotation both read from this array.

import type { ComponentType } from "react";
import type { PageProps } from "./common.js";
import { DailyRunChase } from "./DailyRunChase.js";
import { OfficeRunChase } from "./OfficeRunChase.js";
import { AdviserLeague } from "./AdviserLeague.js";
import { FunnelHealth } from "./FunnelHealth.js";
import { MarketMomentum } from "./MarketMomentum.js";
import { Targets } from "./Targets.js";

export interface PageDef {
  id: string;
  label: string;
  Component: ComponentType<PageProps>;
}

export const PAGES: PageDef[] = [
  { id: "daily", label: "Daily Run Chase", Component: DailyRunChase },
  { id: "offices", label: "Office Run Chase", Component: OfficeRunChase },
  { id: "advisers", label: "Adviser League", Component: AdviserLeague },
  { id: "funnel", label: "Funnel Health", Component: FunnelHealth },
  { id: "momentum", label: "Market Momentum", Component: MarketMomentum },
  { id: "targets", label: "Targets", Component: Targets },
];

// The wall/kiosk rotation is for the office TVs — an upload form has no business there. Every
// PAGE rotates EXCEPT "targets" (must not be missed when adding future admin-only pages either).
export const KIOSK_PAGE_IDS = PAGES.filter((p) => p.id !== "targets").map((p) => p.id);
