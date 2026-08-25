// Scrolling live-feed ticker (navy bar, strawman bottom strip). Content is duplicated so the loop is
// seamless: translateX(-50%) travels exactly one of the two copies.
//
// Speed is derived from a MEASURED content width and a target px/s, not from a per-item guess. The
// old form was `max(6.75, min(15, items * 0.6))`, which had two faults that hid each other: the 15s
// ceiling meant a full 53-item feed scrolled roughly twice as fast as the per-item figure intended,
// and the track's CSS width bug (see .ticker-track) meant it never scrolled past item two anyway, so
// no amount of tuning the duration would have been visible. Capricorn's "speed it up" notes of
// 2026-07-07 and 2026-08-18 were both aimed at a strip that was, in fact, stuck.

import { useEffect, useRef, useState } from "react";

import { EMPTY_FILTERS, usePayload, type Mode } from "../api.js";
import type { LiveFeedPayload } from "../types.js";

/**
 * Scroll speed in px/s — THE number to tune if the wall reads too fast or too slow. Because the
 * duration is computed from this and the real content width, perceived speed stays put whether the
 * feed holds 12 items or 53; only the loop's LENGTH changes.
 *
 * 150px/s puts a ~437px item fully past a fixed point in ~2.9s and keeps it on screen ~14s.
 */
const TICKER_PX_PER_SEC = 150;

/** Fallback duration for the single frame before the track has been measured. */
const UNMEASURED_SECS = 60;

export function Ticker({ mode, refreshMs }: { mode: Mode; refreshMs: number }) {
  const { data } = usePayload<LiveFeedPayload>("live-feed", EMPTY_FILTERS, mode, refreshMs);
  const trackRef = useRef<HTMLDivElement>(null);
  const [anim, setAnim] = useState<{ secs: number; delay: number } | null>(null);
  const count = data?.items.length ?? 0;

  useEffect(() => {
    const el = trackRef.current;
    if (!el || count === 0) return;
    // scrollWidth spans BOTH copies, so one copy is exactly the distance -50% covers.
    const oneCopy = el.scrollWidth / 2;
    if (oneCopy <= 0) return;
    const secs = Math.max(8, Math.round(oneCopy / TICKER_PX_PER_SEC));
    // A NEGATIVE delay phased off the wall clock. The kiosk rotates every 20s and React unmounts this
    // component on each rotation, which restarted the animation at item 1 — with a loop longer than
    // the dwell, the tail of the feed would never be reached at all. Seeding the phase from absolute
    // time makes the strip continuous across rotations: each visit resumes where the clock says it
    // should be, so successive visits show successive slices instead of replaying the opening.
    setAnim({ secs, delay: (Date.now() / 1000) % secs });
  }, [count, data?.dayLabel]);

  if (!data || data.items.length === 0) return null;

  const items = data.items.map((it, i) =>
    // A day marker, not an event: drawn once where the strip crosses into an earlier day. On a busy
    // afternoon the first event is today's and the server emits none of these at all.
    it.kind === "daybreak" ? (
      <div className="ticker-day" key={i}>
        {it.text}
      </div>
    ) : (
      <div className="ticker-item" key={i}>
        <span>{it.icon}</span>
        <span className={it.accent === "green" ? "t-green" : it.accent === "gold" ? "t-gold" : undefined}>
          {it.text}
        </span>
      </div>
    ),
  );

  return (
    <div className="ticker-wrap">
      {/* NO DATE. It read "Latest Activity · Mon 24 Aug", which stood over every item as though
          nothing newer existed — and on a Tuesday morning, when the ~06:00 load holds ~1.5% of a day,
          the strip fell back entirely to Monday and the header confirmed the wall was a day behind.
          Capricorn, 2026-08-25: "just have a ticker running across … so that people can see activity
          happening." The events now span a window ending today (see liveFeed) and any item that is not
          from today says so itself, so the header has nothing left to qualify. */}
      <div className="ticker-label">Latest Activity</div>
      <div className="ticker-outer">
        <div
          ref={trackRef}
          className="ticker-track"
          style={{
            ["--ticker-secs" as string]: `${anim?.secs ?? UNMEASURED_SECS}s`,
            animationDelay: anim ? `-${anim.delay.toFixed(2)}s` : "0s",
          }}
        >
          {items}
          {items}
        </div>
      </div>
    </div>
  );
}
