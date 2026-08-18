// Scrolling live-feed ticker (navy bar, strawman bottom strip). Content is duplicated for a
// seamless loop; speed honours Conor's 2026-07-07 "speed up 2x" note and Capricorn's 2026-08-18
// "25% quicker again" (~6.75-15s, vs ~9-20s before it and ~18-40s originally).

import { EMPTY_FILTERS, usePayload, type Mode } from "../api.js";
import type { LiveFeedPayload } from "../types.js";

export function Ticker({ mode, refreshMs }: { mode: Mode; refreshMs: number }) {
  const { data } = usePayload<LiveFeedPayload>("live-feed", EMPTY_FILTERS, mode, refreshMs);
  if (!data || data.items.length === 0) return null;

  const items = data.items.map((it, i) => (
    <div className="ticker-item" key={i}>
      <span>{it.icon}</span>
      <span className={it.accent === "green" ? "t-green" : it.accent === "gold" ? "t-gold" : undefined}>
        {it.text}
      </span>
    </div>
  ));
  // Scale the loop duration with content so density doesn't change perceived speed (halved vs the
  // original pass for Conor's "2x faster" ask, then a further 25% off on Capricorn's 2026-08-18
  // review — the bounds move with the multiplier, otherwise a short or long feed clamps straight
  // back to the old speed and the change only shows on mid-length feeds).
  const secs = Math.max(6.75, Math.min(15, data.items.length * 0.6));
  return (
    <div className="ticker-wrap">
      <div className="ticker-label">Latest Activity · {data.dayLabel}</div>
      <div className="ticker-outer">
        <div className="ticker-track" style={{ ["--ticker-secs" as string]: `${secs}s` }}>
          {items}
          {items}
        </div>
      </div>
    </div>
  );
}
