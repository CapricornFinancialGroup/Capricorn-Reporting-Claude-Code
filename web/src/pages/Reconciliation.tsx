// Screen 6 — Reconciliation: the screen that is supposed to end the email thread.
//
// Every "your number is wrong" exchange with Capricorn since 28 July came down to one of three
// things, none of which was arithmetic:
//
//   SCOPE     their Total Written Report runs inside ONE entity; the board reports the group.
//             £384,402 vs £413,541 for Sat 25-31 Jul — two right answers to different questions.
//   BASIS     which date column, which statuses. Answered by email four times over.
//   MOVEMENT  a closed week quietly reporting something different a week later. 25-31 Jul protection
//             read £68,951 on 4 Aug and £64,341.82 on 10 Aug. Nothing in the system noticed.
//
// So all three are on one screen, for whichever week you pick, with the rule printed next to the
// figure it produced. Conor's standard (2026-08-03): "nobody ever needs to send an email asking why
// one number differs from another."

import { useState } from "react";
import { usePayload } from "../api.js";
import { clockTime, gbp, longDate, num, shortDate } from "../format.js";
import type { ReconciliationPayload, RevisionSeverity, WeekFigures } from "../types.js";
import { Load, type PageProps } from "./common.js";

const SEVERITY: Record<RevisionSeverity, { label: string; cls: string; blurb: string }> = {
  none: {
    label: "Unchanged",
    cls: "rec-none",
    blurb: "This week has reported the same figures every time it has been checked.",
  },
  settling: {
    label: "Settling",
    cls: "rec-settling",
    blurb:
      "Grown since it closed, inside the window where late data entry explains it. Cases are " +
      "typically entered several days after the business is written, so this is expected.",
  },
  revised: {
    label: "Revised late",
    cls: "rec-revised",
    blurb:
      "Grew after the point where late entry explains it — business was entered against a week that " +
      "should already have been final.",
  },
  reduced: {
    label: "Business removed",
    cls: "rec-reduced",
    blurb:
      "Business that was counted in this week is no longer counted. Cases have been deleted, or have " +
      "dropped out of the reporting feed. This does not correct itself.",
  },
};

function signedMoney(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return `${n > 0 ? "+" : "−"}${gbp(Math.abs(n))}`;
}

function signedCount(n: number): string {
  if (n === 0) return "—";
  return `${n > 0 ? "+" : "−"}${num(Math.abs(n))}`;
}

function deltaCls(n: number): string {
  if (n < -0.005) return "val-red";
  if (n > 0.005) return "val-green";
  return "";
}

function Head() {
  return (
    <thead>
      <tr>
        <th />
        <th className="rec-num">Mortgage</th>
        <th className="rec-num rec-dim">cases</th>
        <th className="rec-num">Protection</th>
        <th className="rec-num rec-dim">cases</th>
        <th className="rec-num">Total written</th>
        <th className="rec-num rec-dim">Client fees</th>
      </tr>
    </thead>
  );
}

function Figures({ f }: { f: WeekFigures }) {
  return (
    <>
      <td className="rec-num">{gbp(f.mortgageCommission)}</td>
      <td className="rec-num rec-dim">{num(f.mortgageCases)}</td>
      <td className="rec-num">{gbp(f.protectionCommission)}</td>
      <td className="rec-num rec-dim">{num(f.protectionCases)}</td>
      <td className="rec-num rec-strong">{gbp(f.mortgageCommission + f.protectionCommission)}</td>
      <td className="rec-num rec-dim">{gbp(f.clientFees)}</td>
    </>
  );
}

export function Reconciliation({ filters, mode, refreshMs }: PageProps) {
  const [week, setWeek] = useState<string | null>(null);
  // A picked week overrides the dashboard date filter; `to` is cleared because the server derives
  // the whole Sat–Fri window from `from` alone.
  const scoped = week ? { ...filters, from: week, to: null } : filters;
  const { data, error } = usePayload<ReconciliationPayload>("reconciliation", scoped, mode, refreshMs);

  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          {/* Anything that moved in a way late entry does not explain, at the top and loud. This is
              what had no home before: the movement was found by hand, six days late. */}
          {data.alerts.length > 0 && (
            <div className="rec-alerts">
              {data.alerts.map((a) => (
                <div key={a.weekStart} className={`rec-alert ${SEVERITY[a.severity].cls}`}>
                  <div className="rec-alert-head">
                    {SEVERITY[a.severity].label} — {a.label} · {shortDate(a.weekStart)} – {shortDate(a.weekEnd)}
                  </div>
                  <div className="rec-alert-body">{SEVERITY[a.severity].blurb}</div>
                  <div className="rec-alert-deltas">
                    {a.deltas.mortgageCommission !== 0 && (
                      <span className={deltaCls(a.deltas.mortgageCommission)}>
                        Mortgage {signedMoney(a.deltas.mortgageCommission)}
                      </span>
                    )}
                    {a.deltas.protectionCommission !== 0 && (
                      <span className={deltaCls(a.deltas.protectionCommission)}>
                        Protection {signedMoney(a.deltas.protectionCommission)}
                      </span>
                    )}
                    {a.deltas.mortgageCases !== 0 && (
                      <span className={deltaCls(a.deltas.mortgageCases)}>
                        {signedCount(a.deltas.mortgageCases)} mortgage cases
                      </span>
                    )}
                    {a.deltas.protectionCases !== 0 && (
                      <span className={deltaCls(a.deltas.protectionCases)}>
                        {signedCount(a.deltas.protectionCases)} protection cases
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rec-weekbar">
            <span className="rec-weekbar-label">Week</span>
            {data.weeks.map((w) => (
              <button
                key={w.start}
                type="button"
                className={`rec-weekbtn ${SEVERITY[w.severity].cls} ${w.start === data.week.start ? "is-active" : ""}`}
                onClick={() => setWeek(w.start)}
                title={`${longDate(w.start)} – ${longDate(w.end)} · ${SEVERITY[w.severity].label}${w.changes ? ` · changed ${w.changes}×` : ""}`}
              >
                {w.label}
                {(w.severity === "reduced" || w.severity === "revised") && <span className="rec-weekdot" />}
              </button>
            ))}
          </div>

          {/* SCOPE — the £32k argument, settled by showing both. */}
          <div className="card">
            <div className="card-title">
              <span>
                Written business · {data.week.label} · {longDate(data.week.start)} – {longDate(data.week.end)}
              </span>
              <span className="card-sub">
                {data.week.provisional
                  ? `still inside the late-entry window, to ${shortDate(data.week.settleThrough)} — may still grow`
                  : "past the late-entry window — should now be final"}
              </span>
            </div>
            <table className="rec-table">
              <Head />
              <tbody>
                {data.live && (
                  <>
                    {/* The entity Kyle actually reconciles against leads the table — he is not
                        looking at group yet (2026-08-10). The group row stays, because the rest of
                        the board reports it and hiding that is how you get two figures and an
                        email. */}
                    {data.live.byOrg
                      .filter((o) => o.key === data.reconcilesToEntity)
                      .map((o) => (
                        <tr key={o.key} className="rec-row-group">
                          <td>
                            <div className="rec-row-name">{o.name}</div>
                            <div className="rec-row-note">
                              Compare your Total Written Report with this row
                            </div>
                          </td>
                          {o.figures ? <Figures f={o.figures} /> : <td className="rec-dim" colSpan={6}>—</td>}
                        </tr>
                      ))}
                    <tr>
                      <td>
                        <div className="rec-row-name">Capricorn group</div>
                        <div className="rec-row-note">Both entities — what every other screen shows</div>
                      </td>
                      <Figures f={data.live.group} />
                    </tr>
                    {data.live.byOrg
                      .filter((o) => o.key !== data.reconcilesToEntity)
                      .map((o) => (
                        <tr key={o.key}>
                          <td>
                            <div className="rec-row-name">{o.name}</div>
                            <div className="rec-row-note">The difference between the two rows above</div>
                          </td>
                          {o.figures ? <Figures f={o.figures} /> : <td className="rec-dim" colSpan={6}>—</td>}
                        </tr>
                      ))}
                  </>
                )}
              </tbody>
            </table>
            <p className="rec-foot">
              Client fees sit apart from the written columns deliberately: they are not commission, and
              Capricorn's Total Written Report is a commission report. Including them is what inflated
              this board against that report until 28 July.
            </p>
          </div>

          <div className="row cols-2 grow">
            {/* MOVEMENT */}
            <div className="card">
              <div className="card-title">
                <span>Has this week changed?</span>
                {data.revision && (
                  <span className="card-sub">
                    watched since {shortDate(data.revision.observedFrom.slice(0, 10))}
                  </span>
                )}
              </div>
              {!data.snapshotsEnabled ? (
                <p className="rec-empty">
                  Snapshot storage isn't configured, so no history is being kept. The figures above are
                  live and correct; what's missing is the record of what they said yesterday.
                </p>
              ) : !data.revision ? (
                <p className="rec-empty">
                  First observation of this week recorded. Movement shows here from the next check
                  onward — there is nothing to compare against yet.
                </p>
              ) : (
                <>
                  <div className={`rec-verdict ${SEVERITY[data.revision.severity].cls}`}>
                    <div className="rec-verdict-label">{SEVERITY[data.revision.severity].label}</div>
                    <div className="rec-verdict-blurb">{SEVERITY[data.revision.severity].blurb}</div>
                  </div>
                  <table className="rec-table">
                    <Head />
                    <tbody>
                      <tr>
                        <td>
                          <div className="rec-row-name">First recorded</div>
                          <div className="rec-row-note">{longDate(data.revision.observedFrom.slice(0, 10))}</div>
                        </td>
                        <Figures f={data.revision.first.group} />
                      </tr>
                      <tr>
                        <td>
                          <div className="rec-row-name">Now</div>
                          <div className="rec-row-note">
                            {data.revision.lastChangedAt
                              ? `last changed ${longDate(data.revision.lastChangedAt.slice(0, 10))}`
                              : "never changed"}
                          </div>
                        </td>
                        <Figures f={data.revision.latest.group} />
                      </tr>
                      <tr className="rec-row-delta">
                        <td>
                          <div className="rec-row-name">Change</div>
                          <div className="rec-row-note">{data.revision.changes}× since first recorded</div>
                        </td>
                        <td className={`rec-num ${deltaCls(data.revision.deltas.mortgageCommission)}`}>
                          {signedMoney(data.revision.deltas.mortgageCommission)}
                        </td>
                        <td className={`rec-num rec-dim ${deltaCls(data.revision.deltas.mortgageCases)}`}>
                          {signedCount(data.revision.deltas.mortgageCases)}
                        </td>
                        <td className={`rec-num ${deltaCls(data.revision.deltas.protectionCommission)}`}>
                          {signedMoney(data.revision.deltas.protectionCommission)}
                        </td>
                        <td className={`rec-num rec-dim ${deltaCls(data.revision.deltas.protectionCases)}`}>
                          {signedCount(data.revision.deltas.protectionCases)}
                        </td>
                        <td
                          className={`rec-num rec-strong ${deltaCls(
                            data.revision.deltas.mortgageCommission + data.revision.deltas.protectionCommission,
                          )}`}
                        >
                          {signedMoney(
                            data.revision.deltas.mortgageCommission + data.revision.deltas.protectionCommission,
                          )}
                        </td>
                        <td className={`rec-num rec-dim ${deltaCls(data.revision.deltas.clientFees)}`}>
                          {signedMoney(data.revision.deltas.clientFees)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>

            {/* BASIS */}
            <div className="card">
              <div className="card-title">
                <span>What these figures mean</span>
                <span className="card-sub">the rule, not a description of it</span>
              </div>
              <dl className="rec-basis">
                {[data.basis.mortgage, data.basis.protection, data.basis.clientFees, data.basis.scope].map((b) => (
                  <div key={b.label} className="rec-basis-item">
                    <dt>{b.label}</dt>
                    <dd>
                      {b.rule}
                      {b.source && <code className="rec-source">{b.source}</code>}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="rec-foot">
                Data as at {longDate(data.dataAsOf)}
                {data.lakeLoadedAt ? ` · lake last loaded ${clockTime(data.lakeLoadedAt)}` : ""}. Every
                figure here is what the data says right now, not a permanent value — which is precisely
                why the panel to the left exists.
              </p>
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
