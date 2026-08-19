// The three cross-ranked leaderboards on the Adviser League.
//
// WHAT THE THREE COLUMNS ARE, AND WHY THEY ARE NOT THE SAME PEOPLE.
//
//   Mortgages Written    mortgage advisers
//   Protection Referred  the same people — protection sold to THEIR clients, whoever wrote it
//   Protection Sales     ~6 protection specialists, who write no mortgages at all
//
// A mortgage adviser is absent from the third board because writing protection is not their job.
// The middle board is what joins the two populations, and it answers Conor's question: who is doing
// well on their own numbers but not on the activity that should follow?
//
// THE CHAIN, AND WHY THE LINES ARE DRAWN ONE ADVISER AT A TIME.
//
//   Mortgages Written → Protection Referred    the SAME person, so a straight hop across
//   Protection Referred → Protection Sales     a different person: who actually converted it
//
// Drawn for everyone at once that is forty-odd curves and unreadable — Kyle, 2026-08-18: "too messy
// and if static doesn't really present well". So there is never more than ONE adviser's chain on
// screen. On the wall a different adviser each turn of the rotation; on the dashboard the links are
// off until asked for, and then the same one-at-a-time tour runs. The tour alternates between the
// Written board and the Referred board so both get their turn as the subject.
//
// ROWS LINE UP BY CONSTRUCTION. Every row is the same fixed height and every sub-line carries the
// same shape — a labelled figure — so row N sits level with row N beside it. The lines are drawn
// between row centres, so a ragged column would make them appear to point at the wrong person.
//
// EVERY NUMBER SAYS WHAT IT IS. This screen used "Apps" and "Refs" until 2026-08-13 (the two labels
// retired for being wrong) and later showed a bare "3" under a name that turned out to mean
// referrals. Both are the same failure: a number with no noun.
//
// The relationship itself is DERIVED from the client, not recorded — Smartr holds no referral event
// (see the footnote on the middle column). A confident-looking wire implies more precision than the
// data has, which is why it is opt-in on the dashboard and why the words on each row are primary.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isRotating, type Mode } from "../api.js";
import type { BoardRow, LeagueBoards as Boards } from "../types.js";
import { gbpCompact, num, shortDate } from "../format.js";

/** How long each adviser holds the tour on the dashboard. The wall advances once per rotation. */
const TOUR_MS = 5000;

/** Which adviser the wall shows. Module-level so it ADVANCES each time the screen rotates back into
 *  view — the kiosk unmounts the page between turns, so component state would reset to the same
 *  person forever. */
let wallTurn = 0;

function rateClass(rate: number | null): string {
  if (rate == null) return "";
  if (rate >= 20) return "lb-hi";
  if (rate < 10) return "lb-lo";
  return "";
}

/** A labelled figure. The label is the point: a bare number under a name means nothing. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="lb-lab">{label}</span> {children}
    </>
  );
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

export function LeagueBoards({ boards, mode }: { boards: Boards; mode?: Mode }) {
  const wall = isRotating(mode ?? "dashboard");

  // The tour alternates Written / Referred so both boards get their turn as the subject. Only people
  // with something to draw are included: a chain needs at least the hop to their own referred row.
  const tour = useMemo(() => {
    const canDraw = (name: string) => {
      const r = boards.referred.find((x) => x.name === name);
      return r != null && (r.referred > 0 || r.partners.length > 0);
    };
    const w = boards.written.map((r) => r.name).filter(canDraw);
    const rf = boards.referred.map((r) => r.name).filter(canDraw);
    const out: string[] = [];
    for (let i = 0; i < Math.max(w.length, rf.length); i++) {
      if (w[i] && !out.includes(w[i])) out.push(w[i]);
      if (rf[i] && !out.includes(rf[i])) out.push(rf[i]);
    }
    return out;
  }, [boards]);

  const [showLinks, setShowLinks] = useState(wall);
  const [subject, setSubject] = useState<string | null>(null);

  // Wall: one adviser per rotation, advancing across mounts.
  useEffect(() => {
    if (!wall || tour.length === 0) return;
    setSubject(tour[wallTurn % tour.length]);
    wallTurn += 1;
  }, [wall, tour]);

  // Dashboard: once links are on, the same one-at-a-time tour runs on a timer.
  useEffect(() => {
    if (wall || !showLinks || tour.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSubject(tour[0]);
      return;
    }
    let i = 0;
    setSubject(tour[0]);
    const id = window.setInterval(() => {
      i = (i + 1) % tour.length;
      setSubject(tour[i]);
    }, TOUR_MS);
    return () => window.clearInterval(id);
  }, [wall, showLinks, tour]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const paint = () => {
      if (!showLinks || !subject) { svg.innerHTML = ""; return; }
      const box = wrap.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const find = (col: string, name: string) =>
        wrap.querySelector<HTMLElement>(`[data-col="${col}"] [data-name="${CSS.escape(name)}"]`);
      const parts: string[] = [];
      const curve = (a: HTMLElement, b: HTMLElement, width: number) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = ra.right - box.left;
        const y1 = ra.top + ra.height / 2 - box.top;
        const x2 = rb.left - box.left;
        const y2 = rb.top + rb.height / 2 - box.top;
        const mid = (x1 + x2) / 2;
        parts.push(
          `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" ` +
            `stroke="currentColor" stroke-width="${width}" stroke-linecap="round" opacity="0.85"/>`,
        );
      };

      // Hop one: the adviser's own row, Written across to Referred. Same person both ends.
      const w = find("written", subject);
      const rf = find("referred", subject);
      if (w && rf) curve(w, rf, 2);

      // Hop two: their referred sales out to whoever converted each of them.
      const ref = boards.referred.find((r) => r.name === subject);
      if (rf && ref) {
        for (const p of ref.partners) {
          const sold = find("sold", p.name);
          if (sold) curve(rf, sold, 1.4 + p.n * 0.9);
        }
      }
      svg.innerHTML = parts.join("");
    };
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, [boards, showLinks, subject]);

  // Rows only dim when there is something drawn to dim them against.
  const focused = showLinks ? subject : null;
  const partners = focused ? (boards.referred.find((r) => r.name === focused)?.partners ?? []) : [];
  const inChain = (name: string) => name === focused || partners.some((p) => p.name === name);
  const isLit = (name: string) => focused != null && inChain(name);
  const isDim = (name: string) => focused != null && !inChain(name);

  const attributionPct = boards.attribution.pct == null ? null : Math.round(boards.attribution.pct * 100);

  return (
    <>
      <div className="lb-strip">
        <span className="lb-strip-label">Leaderboards</span>
        <span className="lb-strip-window">
          {boards.window.weeks} weeks · {shortDate(boards.window.from)} – {shortDate(boards.window.to)}
        </span>
        <span className="lb-strip-note">Same window as the figures above.</span>
        {focused && (
          <span className="lb-spot">Chain shown for <b>{focused}</b></span>
        )}
        {!wall && tour.length > 0 && (
          <button
            type="button"
            className={`lb-links-btn${showLinks ? " on" : ""}`}
            aria-pressed={showLinks}
            onClick={() => { setShowLinks((v) => !v); if (showLinks) setSubject(null); }}
            title="Trace one adviser at a time: their mortgages written across to the protection referred from their clients, then out to whoever converted it. Off by default — the relationship is spelled out on every row in words, which is the version that can carry its caveat."
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
                  <Fact label="Referred">
                    <b className={rateClass(r.rate)}>{r.referred}</b>
                    {r.rate != null && <> · <span className={rateClass(r.rate)}>{r.rate}%</span> of clients</>}
                  </Fact>
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
                  <Fact label="Written">
                    <b>{r.written}</b>
                    {r.rate != null && <> · <span className={rateClass(r.rate)}>{r.rate}%</span> converted</>}
                  </Fact>
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
                detail={<Fact label="Commission"><b>{gbpCompact(r.commission)}</b></Fact>}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
