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
// THE CONNECTING LINES, AND WHY THEY WORK THIS WAY.
//
// Curved wires between Referred and Sales were drawn for every pair, permanently, with a spotlight
// touring the board. Kyle, 2026-08-18: "too messy and if static doesn't really present well — lets
// remove the 'link' for now please." He was right about the symptom. Drawing forty-odd wires at once
// is unreadable, and a static thicket of them says nothing.
//
// They are back in the only form that answers that:
//
//   Dashboard — OFF by default, behind a button. Nobody is made to look at them.
//   Wall      — ON, but never more than ONE mortgage adviser's links at a time, a different adviser
//               each time the screen comes round. One name, two or three lines, legible across a room.
//
// The spotlight is bound to the links: dimming rows with nothing drawn between them is what made the
// old tour meaningless once the wires were pulled, so if links are off, nothing dims.
//
// A caveat that has not changed: the relationship is DERIVED from the client, not recorded (Smartr
// holds no referral event — see the footnote on the Referred column). A confident-looking wire
// implies more precision than the data has, which is exactly why it is opt-in and why the words on
// each row, where the inference can be qualified, remain the primary cross-reference.
//
// Words, not initials. This screen used "Apps" and "Refs" until 2026-08-13 — the two labels retired
// for being wrong — and nobody could tell what they meant. Every number says what it is.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isRotating, type Mode } from "../api.js";
import type { BoardRow, LeagueBoards as Boards } from "../types.js";
import { gbpCompact, num, shortDate } from "../format.js";

/** Which adviser the wall highlights. Module-level so it ADVANCES each time the screen rotates back
 *  into view — the kiosk unmounts the page between turns, so component state would reset to the same
 *  person forever. */
let wallTurn = 0;

function rateClass(rate: number | null): string {
  if (rate == null) return "";
  if (rate >= 20) return "lb-hi";
  if (rate < 10) return "lb-lo";
  return "";
}

function Row({ row, detail, unit, lit, dim }: {
  row: BoardRow;
  detail: React.ReactNode;
  unit: string;
  lit: boolean;
  dim: boolean;
}) {
  return (
    <div
      className={`lb-row${row.rank === 1 ? " lb-first" : ""}${lit ? " lb-lit" : ""}${dim ? " lb-dim" : ""}`}
      data-name={row.name}
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

export function LeagueBoards({ boards, mode }: { boards: Boards; mode?: Mode }) {
  const wall = isRotating(mode ?? "dashboard");
  // Advisers whose referrals someone converted — the only ones a line has both ends for.
  const linkable = boards.referred.filter((r) => r.partners.length > 0);

  // On the wall the links are always on and always narrowed to one adviser. On the dashboard they
  // start off, and turning them on shows all of them (there is a mouse to explore with).
  const [showLinks, setShowLinks] = useState(wall);
  const [spotlight, setSpotlight] = useState<string | null>(null);

  useEffect(() => {
    if (!wall || linkable.length === 0) return;
    const pick = linkable[wallTurn % linkable.length];
    wallTurn += 1;
    setSpotlight(pick.name);
  }, [wall, linkable]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const paint = () => {
      if (!showLinks) { svg.innerHTML = ""; return; }
      const box = wrap.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const find = (col: string, name: string) =>
        wrap.querySelector<HTMLElement>(`[data-col="${col}"] [data-name="${CSS.escape(name)}"]`);
      const parts: string[] = [];
      for (const r of boards.referred) {
        if (spotlight && r.name !== spotlight) continue;
        const a = find("referred", r.name);
        if (!a) continue;
        for (const p of r.partners) {
          const b = find("sold", p.name);
          if (!b) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const x1 = ra.right - box.left;
          const y1 = ra.top + ra.height / 2 - box.top;
          const x2 = rb.left - box.left;
          const y2 = rb.top + rb.height / 2 - box.top;
          const mid = (x1 + x2) / 2;
          parts.push(
            `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" ` +
              `stroke="currentColor" stroke-width="${1.4 + p.n * 0.9}" stroke-linecap="round" opacity="0.85"/>`,
          );
        }
      }
      svg.innerHTML = parts.join("");
    };
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, [boards, showLinks, spotlight]);

  // Rows only dim when there is something drawn to dim them against.
  const focused = showLinks ? spotlight : null;
  const partnersOf = (name: string) =>
    boards.referred.find((r) => r.name === name)?.partners.map((p) => p.name) ?? [];
  const inFocus = (name: string) => focused != null && (name === focused || partnersOf(focused).includes(name));
  const isLit = (name: string) => focused != null && inFocus(name);
  const isDim = (name: string) => focused != null && !inFocus(name);

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
        {wall
          ? spotlight && (
              <span className="lb-spot">Referrals shown for <b>{spotlight}</b></span>
            )
          : linkable.length > 0 && (
              <button
                type="button"
                className={`lb-links-btn${showLinks ? " on" : ""}`}
                aria-pressed={showLinks}
                onClick={() => setShowLinks((v) => !v)}
                title="Draw the referral links between Protection Referred and Protection Sales. Off by default: the relationship is spelled out on each row in words, which is the version that can carry its caveat."
              >
                {showLinks ? "Hide links" : "Show links"}
              </button>
            )}
      </div>

      <div className="lb-wrap" ref={wrapRef}>
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
                detail={<><b>{gbpCompact(r.commission)}</b> commission</>}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
