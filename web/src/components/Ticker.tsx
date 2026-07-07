// Scrolling live-feed ticker (navy bar, strawman bottom strip). Content is duplicated for a
// seamless loop; speed honours Conor's 2026-07-07 "speed up 2x" note (~9-16s vs the ~18-40s prior).

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
  // original pass for Conor's "2x faster" ask).
  const secs = Math.max(9, Math.min(20, data.items.length * 0.8));
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
