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
//     28% of clients · sold by Jack ×2". That printed text is now the ONLY cross-reference.
//
//     There were also curved lines drawn between the Referred and Sales columns, with a spotlight
//     touring the board to light one adviser's lines at a time. Removed 2026-08-18 on Kyle's
//     instruction: "The link between Protection Referred and Protection Sales is too messy and if
//     static doesn't really present well — lets remove the 'link' for now please." He is right about
//     why: the lines were drawn from a DERIVED relationship (see the footnote on the Referred
//     column — Smartr holds no referral event, so the link is inferred from the client), and a
//     confident-looking wire between two named people implies a precision the underlying data does
//     not have. The spotlight went with them: without lines to light, it only dimmed rows at random.
//     The relationship itself is unchanged and still on screen, in words, where it can be qualified.
//  2. Words, not initials. The previous version of this screen used "Apps" and "Refs", the two
//     labels retired for being wrong, and nobody could tell what they meant. Every number here says
//     what it is: written, referred, sold.

import type { BoardRow, LeagueBoards as Boards } from "../types.js";
import { gbpCompact, num, shortDate } from "../format.js";

function rateClass(rate: number | null): string {
  if (rate == null) return "";
  if (rate >= 20) return "lb-hi";
  if (rate < 10) return "lb-lo";
  return "";
}

/** One row. `detail` is the spelled-out shorthand — the only thing a wall viewer gets. */
function Row({ row, detail, unit }: {
  row: BoardRow;
  detail: React.ReactNode;
  unit: string;
}) {
  return (
    <div className={`lb-row${row.rank === 1 ? " lb-first" : ""}`} data-name={row.name}>
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
      </div>

      <div className="lb-wrap">
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
                detail={<><b>{gbpCompact(r.commission)}</b> commission</>}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
