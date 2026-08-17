// The three cross-ranked leaderboards on the Adviser League.
//
// WHAT THE THREE COLUMNS ARE, AND WHY THEY ARE NOT THE SAME PEOPLE.
//
//   Mortgages Written    ~59 mortgage advisers
//   Protection Referred  the same people — protection sold to THEIR clients, whoever wrote it
//   Protection Sales     ~6 protection specialists, who write no mortgages at all
//
// A mortgage adviser is absent from the third board because writing protection is not their job.
// The REFERRED board is what links the two populations, and it is the one that answers Conor's
// question: who is doing well on their own numbers but not on the activity that should follow?
//
// TWO DESIGN CONSTRAINTS, BOTH FROM THE ROOM THIS IS READ IN.
//
//  1. The office TVs have no mouse. So every cross-reference is PRINTED on the row — "8 referred ·
//     28% of clients · converted by Jack ×2" — and the connecting lines are drawn permanently rather
//     than on hover. A spotlight walks the board on its own so the relationships read from a desk
//     away, with nobody touching anything.
//  2. Words, not initials. The previous version of this screen used "Apps" and "Refs", the two
//     labels retired for being wrong, and nobody could tell what they meant. Every number here says
//     what it is: written, referred, sold.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BoardRow, LeagueBoards as Boards } from "../types.js";
import { gbpCompact, num, shortDate } from "../format.js";

/** How long each adviser holds the spotlight on an unattended screen. */
const SPOTLIGHT_MS = 4500;

function rateClass(rate: number | null): string {
  if (rate == null) return "";
  if (rate >= 20) return "lb-hi";
  if (rate < 10) return "lb-lo";
  return "";
}

/** One row. `detail` is the spelled-out shorthand — the only thing a wall viewer gets. */
function Row({ row, detail, unit, lit, dim, onFocus }: {
  row: BoardRow;
  detail: React.ReactNode;
  unit: string;
  lit: boolean;
  dim: boolean;
  onFocus: (name: string) => void;
}) {
  return (
    <div
      className={`lb-row${row.rank === 1 ? " lb-first" : ""}${lit ? " lb-lit" : ""}${dim ? " lb-dim" : ""}`}
      data-name={row.name}
      tabIndex={0}
      onMouseEnter={() => onFocus(row.name)}
      onFocus={() => onFocus(row.name)}
    >
      <span className="lb-rank">{row.rank}</span>
      <span className="lb-who">
        <b>{row.name}</b>
        <span className="lb-detail">{detail}</span>
      </span>
      <span className="lb-value">
        {num(row.value)}
        <span className="lb-unit">{unit}</span>
      </span>
    </div>
  );
}

function partnerText(row: BoardRow): string {
  if (!row.partners.length) return "";
  return row.partners.map((p) => `${p.name.split(" ")[0]} ×${p.n}`).join(", ");
}

export function LeagueBoards({ boards }: { boards: Boards }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  // Advisers worth walking: those whose referrals someone converted, so the line has both ends.
  const tour = boards.referred.filter((r) => r.partners.length > 0).map((r) => r.name);

  // The wall has no mouse. Left alone, the board tours itself; a hover takes over and the tour
  // resumes when the pointer leaves.
  useEffect(() => {
    if (paused || tour.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % tour.length;
      setFocus(tour[i]);
    }, SPOTLIGHT_MS);
    return () => window.clearInterval(id);
  }, [paused, tour.length, tour]);

  // Draw the referral lines. Always on — thickness by volume — so the relationships are visible
  // without interaction; the focused adviser's lines come forward and the rest recede.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const paint = () => {
      const box = wrap.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const find = (col: string, name: string) =>
        wrap.querySelector<HTMLElement>(`[data-col="${col}"] [data-name="${CSS.escape(name)}"]`);
      const parts: string[] = [];
      for (const r of boards.referred) {
        const a = find("referred", r.name);
        if (!a) continue;
        for (const p of r.partners) {
          const b = find("sold", p.name);
          if (!b) continue;
          const on = focus == null || focus === r.name;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const x1 = ra.right - box.left;
          const y1 = ra.top + ra.height / 2 - box.top;
          const x2 = rb.left - box.left;
          const y2 = rb.top + rb.height / 2 - box.top;
          const mid = (x1 + x2) / 2;
          parts.push(
            `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" ` +
              `stroke="currentColor" stroke-width="${on ? 1.2 + p.n * 0.9 : 1}" ` +
              `stroke-linecap="round" opacity="${on ? 0.85 : 0.12}"/>`,
          );
        }
      }
      svg.innerHTML = parts.join("");
    };
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, [boards, focus]);

  const isDim = (name: string) => {
    if (focus == null) return false;
    if (name === focus) return false;
    const f = boards.referred.find((r) => r.name === focus);
    return !f?.partners.some((p) => p.name === name);
  };
  const isLit = (name: string) => focus != null && !isDim(name);

  const attributionPct = boards.attribution.pct == null ? null : Math.round(boards.attribution.pct * 100);

  return (
    <>
      <div className="lb-strip">
        <span className="lb-strip-label">Leaderboards</span>
        <span className="lb-strip-window">
          Ranked over {boards.window.weeks} weeks · {shortDate(boards.window.from)} – {shortDate(boards.window.to)}
        </span>
        <span className="lb-strip-note">
          A single week ranks on one or two cases; four weeks ranks on behaviour.
        </span>
        <button
          type="button"
          className={`lb-pause${paused ? "" : " on"}`}
          onClick={() => { setPaused((p) => !p); if (!paused) setFocus(null); }}
        >
          {paused ? "Paused" : "Touring"}
        </button>
      </div>

      <div className="lb-wrap" ref={wrapRef} onMouseLeave={() => !paused && undefined}>
        <svg className="lb-wires" ref={svgRef} aria-hidden="true" />

        <section className="card lb-col" data-col="written">
          <div className="card-title">
            <span className="league-panel-title blue">Mortgages Written</span>
            <span className="card-sub">mortgage advisers</span>
          </div>
          <div className="lb-rows">
            {boards.written.map((r) => (
              <Row
                key={r.name}
                row={r}
                unit="written"
                lit={isLit(r.name)}
                dim={isDim(r.name)}
                onFocus={setFocus}
                detail={
                  <>
                    <b className={rateClass(r.rate)}>{r.referred}</b> referred
                    {r.rate != null && <> · <span className={rateClass(r.rate)}>{r.rate}%</span> of clients</>}
                  </>
                }
              />
            ))}
          </div>
        </section>

        <section className="card lb-col" data-col="referred">
          <div className="card-title">
            <span className="league-panel-title green">Protection Referred</span>
            <span className="card-sub">
              sales to their clients{attributionPct != null ? ` · ${attributionPct}% attributed` : ""}
            </span>
          </div>
          <div className="lb-rows">
            {boards.referred.map((r) => (
              <Row
                key={r.name}
                row={r}
                unit="referred"
                lit={isLit(r.name)}
                dim={isDim(r.name)}
                onFocus={setFocus}
                detail={
                  <>
                    from <b>{r.written}</b> written
                    {r.rate != null && <> · <span className={rateClass(r.rate)}>{r.rate}%</span></>}
                    {r.partners.length > 0 && <> · sold by {partnerText(r)}</>}
                  </>
                }
              />
            ))}
          </div>
          <p className="lb-foot">
            Derived from the client, not from a recorded referral — Smartr holds no referral event.
            Indicative for management; not a basis for paying commission.
          </p>
        </section>

        <section className="card lb-col" data-col="sold">
          <div className="card-title">
            <span className="league-panel-title amber">Protection Sales</span>
            <span className="card-sub">protection advisers</span>
          </div>
          <div className="lb-rows">
            {boards.sold.map((r) => (
              <Row
                key={r.name}
                row={r}
                unit="sold"
                lit={isLit(r.name)}
                dim={isDim(r.name)}
                onFocus={setFocus}
                detail={<><b>{gbpCompact(r.commission)}</b> commission</>}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
