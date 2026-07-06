// Scrolling live-feed ticker (navy bar, strawman bottom strip). Content is duplicated for a
// seamless loop; speed honours Conor's "2–3× faster" note (~22s vs the strawman's 56s).

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
  // Scale the loop duration with content so density doesn't change perceived speed.
  const secs = Math.max(18, Math.min(40, data.items.length * 1.6));
  return (
    <div className="ticker-wrap">
      <div className="ticker-label">Live Feed · {data.dayLabel}</div>
      <div className="ticker-outer">
        <div className="ticker-track" style={{ ["--ticker-secs" as string]: `${secs}s` }}>
          {items}
          {items}
        </div>
      </div>
    </div>
  );
}
