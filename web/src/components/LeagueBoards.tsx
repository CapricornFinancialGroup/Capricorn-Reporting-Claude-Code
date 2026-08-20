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
// screen. On the wall a different adviser each turn of the rotation; on the dashboard HOVER a row and
// that adviser's chain appears, or start the tour and the same one-at-a-time walk runs on a timer.
//
// AND WHEN THERE IS NOTHING ON THE OTHER BOARD TO JOIN TO, THE LINE SAYS SO. A top-ten writer is
// often outside the referred top ten (and vice versa). That used to disqualify them from being the
// subject at all, which is what "it seems to stop doing the linking lines" was — an intermittent
// subject, not intermittent breakage. Capricorn, 2026-08-19: "I still want to be able to highlight
// ones that are. When we highlight one that isn't in the top 10 of the protection referred, it just
// highlights them, but the line goes underneath the tile to show that they are outside of that top
// 10." So the line is drawn either way: solid across to their row, or dashed and dropping off the
// bottom of that column. Thirty-seven mortgages written and three protection referrals is the single
// most useful thing this screen can say, and it needs the adviser to be showable to say it.
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
// data has, which is why the automatic tour is opt-in on the dashboard and why the words on each row
// are primary.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isRotating, type Mode } from "../api.js";
import type { BoardRow, LeagueBoards as Boards } from "../types.js";
import { gbpCompact, num, shortDate } from "../format.js";

/** How long each adviser holds the tour on the dashboard. The wall advances once per rotation. */
const TOUR_MS = 5000;

/** How far below a column the "you are not on this board" line ends. `.screen` carries 12px of bottom
 *  padding, so this lands inside it — clear of the tile, and not clipped. */
const OFF_BOARD_DROP = 8;

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

function Row({ row, detail, unit, lit, dim, onHover }: {
  row: BoardRow;
  detail: React.ReactNode;
  unit: string;
  lit: boolean;
  dim: boolean;
  /** Dashboard only — the wall has no mouse, so it passes nothing and the row is inert. */
  onHover?: (name: string) => void;
}) {
  return (
    <div
      className={`lb-row${row.rank === 1 ? " lb-first" : ""}${lit ? " lb-lit" : ""}${dim ? " lb-dim" : ""}${onHover ? " lb-hoverable" : ""}`}
      data-name={row.name}
      onMouseEnter={onHover ? () => onHover(row.name) : undefined}
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

  // The tour is the UNION of the two originator boards, alternating so both get their turn as the
  // subject. It used to be the intersection — only advisers with a row in BOTH — because the parity
  // hop needs two rows to join. That silently dropped four of ten subjects, and dropped exactly the
  // interesting ones: a big writer with almost nothing referred is precisely who this screen is for.
  // They are back, and the missing end of their line is now DRAWN as missing (see `offBoard`).
  //
  // Protection specialists are not in the tour: they are the far end of other people's chains, not
  // originators. They are still hoverable on the dashboard, which traces the chain backwards.
  const tour = useMemo(() => {
    const w = boards.written.map((r) => r.name);
    const rf = boards.referred.map((r) => r.name);
    const out: string[] = [];
    for (let i = 0; i < Math.max(w.length, rf.length); i++) {
      if (w[i] && !out.includes(w[i])) out.push(w[i]);
      if (rf[i] && !out.includes(rf[i])) out.push(rf[i]);
    }
    return out;
  }, [boards]);

  const [touring, setTouring] = useState(wall);
  const [toured, setToured] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // A hover takes the board over; otherwise the tour holds it, if it is running. Hover is the reason
  // the highlight exists at all on a desk — it was removed in the 2026-08-19 tidy-up and Capricorn
  // noticed it was gone ("I still don't see any highlight ... We used to have that").
  const subject = hover ?? (touring ? toured : null);

  // Wall: one adviser per rotation, advancing across mounts.
  useEffect(() => {
    if (!wall || tour.length === 0) return;
    setToured(tour[wallTurn % tour.length]);
    wallTurn += 1;
  }, [wall, tour]);

  // Dashboard: the tour walks the same list on a timer. The index lives in a ref so that a hover
  // pausing the timer does not restart the walk from the top when the mouse leaves.
  const tourIdx = useRef(0);
  useEffect(() => {
    if (wall || !touring || tour.length === 0) return;
    setToured(tour[tourIdx.current % tour.length]);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (hover) return; // hovering holds the board still — advancing under the mouse fights the user
    const id = window.setInterval(() => {
      tourIdx.current = (tourIdx.current + 1) % tour.length;
      setToured(tour[tourIdx.current]);
    }, TOUR_MS);
    return () => window.clearInterval(id);
  }, [wall, touring, tour, hover]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    const paint = () => {
      if (!subject) { svg.innerHTML = ""; return; }
      const box = wrap.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      const column = (col: string) => wrap.querySelector<HTMLElement>(`[data-col="${col}"]`);
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

      /** The subject is not ON that board. The line leaves their row and drops off the bottom of the
       *  column, ending in a short bar under the tile: "below tenth place". Dashed, because it points
       *  at an absence rather than at a person — and an absence is the finding, not a gap in the data. */
      const offBoard = (from: HTMLElement, col: HTMLElement, width: number) => {
        const ra = from.getBoundingClientRect();
        const rc = col.getBoundingClientRect();
        const toLeft = rc.right <= ra.left; // the column we are pointing at sits left of the row
        const x1 = (toLeft ? ra.left : ra.right) - box.left;
        const y1 = ra.top + ra.height / 2 - box.top;
        const x2 = rc.left + rc.width / 2 - box.left;
        const y2 = rc.bottom - box.top + OFF_BOARD_DROP;
        parts.push(
          `<path d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" ` +
            `fill="none" stroke="currentColor" stroke-width="${width}" stroke-dasharray="5 4" ` +
            `stroke-linecap="round" opacity="0.75"/>`,
          `<path d="M ${x2 - 16} ${y2} L ${x2 + 16} ${y2}" fill="none" stroke="currentColor" ` +
            `stroke-width="${width}" stroke-linecap="round" opacity="0.75"/>`,
        );
      };

      const inWritten = find("written", subject);
      const inReferred = find("referred", subject);
      const inSold = find("sold", subject);
      const ref = boards.referred.find((r) => r.name === subject);

      // Hop one — parity. The same person both ends when both ends exist; otherwise the line drops
      // below whichever board they are not on.
      if (inWritten && inReferred) curve(inWritten, inReferred, 2);
      else if (inWritten) { const c = column("referred"); if (c) offBoard(inWritten, c, 2); }
      else if (inReferred) { const c = column("written"); if (c) offBoard(inReferred, c, 2); }

      // Hop two — their referred sales out to whoever converted each one.
      if (inReferred && ref) {
        for (const p of ref.partners) {
          const sold = find("sold", p.name);
          if (sold) curve(inReferred, sold, 1.4 + p.n * 0.9);
        }
      }

      // A protection specialist is never an originator, so their row has no chain of its own. Trace it
      // backwards instead — who feeds them — rather than leaving a hovered row drawing nothing, which
      // is indistinguishable from the highlight being broken.
      if (inSold && !ref) {
        for (const r of boards.referred) {
          const p = r.partners.find((x) => x.name === subject);
          const from = p && find("referred", r.name);
          if (p && from) curve(from, inSold, 1.4 + p.n * 0.9);
        }
      }

      svg.innerHTML = parts.join("");
    };
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, [boards, subject]);

  // Who lights up alongside the subject: the people at the other end of a line we actually draw.
  const chain = useMemo(() => {
    const set = new Set<string>();
    if (!subject) return set;
    set.add(subject);
    const ref = boards.referred.find((r) => r.name === subject);
    for (const p of ref?.partners ?? []) set.add(p.name);
    if (!ref && boards.sold.some((r) => r.name === subject)) {
      for (const r of boards.referred) if (r.partners.some((p) => p.name === subject)) set.add(r.name);
    }
    return set;
  }, [boards, subject]);

  const isLit = (name: string) => subject != null && chain.has(name);
  const isDim = (name: string) => subject != null && !chain.has(name);
  const onHover = wall ? undefined : setHover;

  // Says in words what the dashed line says in pixels. Without it the line is a shape people have to
  // guess at, and the guess ("broken?") is the wrong one.
  const offBoardNote = (() => {
    if (subject == null) return null;
    const onWritten = boards.written.some((r) => r.name === subject);
    const onReferred = boards.referred.some((r) => r.name === subject);
    if (onWritten && !onReferred) return "outside the Protection Referred top 10 — the line drops below that board";
    if (onReferred && !onWritten) return "outside the Mortgages Written top 10 — the line drops below that board";
    return null;
  })();

  const attributionPct = boards.attribution.pct == null ? null : Math.round(boards.attribution.pct * 100);

  return (
    <>
      <div className="lb-strip">
        <span className="lb-strip-label">Leaderboards</span>
        <span className="lb-strip-window">
          {boards.window.weeks} weeks · {shortDate(boards.window.from)} – {shortDate(boards.window.to)}
        </span>
        <span className="lb-strip-note">
          Same window as the figures above.{!wall && " Hover any row to trace that adviser."}
        </span>
        {subject && (
          <span className="lb-spot">
            Chain shown for <b>{subject}</b>
            {offBoardNote && <span className="lb-spot-off"> · {offBoardNote}</span>}
          </span>
        )}
        {!wall && tour.length > 0 && (
          <button
            type="button"
            className={`lb-links-btn${touring ? " on" : ""}`}
            aria-pressed={touring}
            onClick={() => { setTouring((v) => !v); if (touring) setToured(null); }}
            title="Walk the boards one adviser at a time: their mortgages written across to the protection referred from their clients, then out to whoever converted it. Hovering a row does the same for that adviser without starting the walk."
          >
            {touring ? "Stop tour" : "Tour advisers"}
          </button>
        )}
      </div>

      <div className="lb-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
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
                onHover={onHover}
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
                onHover={onHover}
                detail={
                  <Fact label="Written">
                    <b>{r.written}</b>
                    {r.rate != null && <> · <span className={rateClass(r.rate)}>{r.rate}%</span> converted</>}
                  </Fact>
                }
              />
            ))}
          </div>
          {/* The tie-break is stated, because a rank nobody can reproduce from the row it sits on is
              just an assertion. Capricorn asked for it on 2026-08-19: three advisers on 3 referrals
              each printed as three sixth places, and 100% / 21% / 8% of their own clients is not a tie. */}
          <p className="lb-foot">
            Level on referrals? Ranked by the higher % converted. Derived from the client, not from a
            recorded referral — Smartr holds no referral event. Indicative for management; not a basis
            for paying commission.
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
                onHover={onHover}
                detail={<Fact label="Commission"><b>{gbpCompact(r.commission)}</b></Fact>}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
