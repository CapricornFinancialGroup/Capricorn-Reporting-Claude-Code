// Weekly targets admin page (item 1, 2026-07-07) — folded into the dashboard tab nav, excluded from
// KIOSK_PAGE_IDS (pages/index.ts). ONE upload (Luke, 2026-07-17): Capricorn's consolidated weekly
// Datarails workbook drives everything the file carries — Applications, Protection (sales/referral
// pledge) and Revenue (written commission). Leads is NOT in that file and never has been, so it has
// its own small form below — before 2026-08-19 there was no route to set it at all and the wall was
// showing our headcount placeholder as though Capricorn had chosen it.

import { useState } from "react";
import { gbpCompact, num } from "../format.js";
import type { PageProps } from "./common.js";

interface UploadResult {
  ok: boolean;
  error?: string;
  hardErrors?: string[];
  softWarnings?: string[];
  unmatchedAdvisers?: string[];
}

/** Next Saturday (today inclusive) as YYYY-MM-DD — the Datarails workbook's week columns are
 *  Saturday-anchored, and targets are set at the start of the week just gone. */
function nextSaturdayIso(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + ((6 - day + 7) % 7));
  return d.toISOString().slice(0, 10);
}

export function Targets({ meta }: PageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [week, setWeek] = useState(nextSaturdayIso);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const provenance = meta.targetsProvenance;
  const leadsUnconfirmed = (provenance.unconfirmed ?? []).includes("leads");

  // Seeded from the live weekly figures (the store exposes DAILY, hence x5) so the form opens showing
  // what the board is currently using rather than blank boxes.
  const [leadsWeek, setLeadsWeek] = useState(nextSaturdayIso);
  const [leads, setLeads] = useState<Record<string, string>>(() =>
    Object.fromEntries(meta.offices.map((o) => [o.name, String(Math.round((meta.targets.officeDaily[o.name]?.leads ?? 0) * 5))])),
  );
  const [savingLeads, setSavingLeads] = useState(false);
  const [leadsResult, setLeadsResult] = useState<UploadResult | null>(null);
  const leadsTotal = meta.offices.reduce((a, o) => a + (Number(leads[o.name]) || 0), 0);

  const saveLeads = async () => {
    setSavingLeads(true);
    setLeadsResult(null);
    try {
      const res = await fetch("/api/targets/set-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week: leadsWeek, leads }),
      });
      const json = (await res.json()) as UploadResult;
      if (res.ok && json.ok) {
        setLeadsResult({ ok: true, softWarnings: json.softWarnings });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setLeadsResult({ ok: false, error: json.error, hardErrors: json.hardErrors, softWarnings: json.softWarnings });
      }
    } catch (err) {
      setLeadsResult({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setSavingLeads(false);
    }
  };

  const importDatarails = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("week", week);
      body.append("file", file);
      const res = await fetch("/api/targets/import-datarails", { method: "POST", body });
      const json = (await res.json()) as UploadResult;
      if (res.ok && json.ok) {
        setResult({ ok: true, softWarnings: json.softWarnings, unmatchedAdvisers: json.unmatchedAdvisers });
        // meta has no polling (refreshMs=0) — reload so the new provenance/targets actually show.
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult({ ok: false, error: json.error, hardErrors: json.hardErrors, softWarnings: json.softWarnings });
      }
    } catch (err) {
      setResult({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title"><span>Current Targets</span></div>
        {provenance.source === "upload" ? (
          <div className="placeholder-note">
            Effective week {provenance.effectiveWeek} — uploaded by {provenance.uploadedBy} on{" "}
            {provenance.uploadedAt ? new Date(provenance.uploadedAt).toLocaleString("en-GB") : "—"}.
            {provenance.note && <div>{provenance.note}</div>}
          </div>
        ) : (
          <div className="placeholder-note">
            No upload yet — showing data-derived placeholder targets pending Capricorn confirmation.
          </div>
        )}
        <table className="lb-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Office</th>
              <th>Leads</th>
              <th>Applications</th>
              <th>Referrals</th>
              <th>Sales</th>
            </tr>
          </thead>
          <tbody>
            {meta.offices.map((o) => {
              const daily = meta.targets.officeDaily[o.name];
              return (
                <tr key={o.name}>
                  <td className="office-name">{o.name}</td>
                  <td>{daily ? num(Math.round(daily.leads * 5)) : "—"}</td>
                  <td>{daily ? num(Math.round(daily.applications * 5)) : "—"}</td>
                  <td>{daily ? num(Math.round(daily.referrals * 5)) : "—"}</td>
                  <td>{daily ? num(Math.round(daily.sales * 5)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="placeholder-note" style={{ marginTop: 6 }}>
          Weekly Written target (Revenue): Mortgage {gbpCompact(meta.targets.writtenWeekly.mortgage)} + Insurance{" "}
          {gbpCompact(meta.targets.writtenWeekly.insurance)} = {gbpCompact(meta.targets.writtenWeekly.mortgage + meta.targets.writtenWeekly.insurance)}.
          All figures above are weekly.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Leads Target</span>
          {leadsUnconfirmed && <span className="gos-warn-pill">Not yet set by Capricorn</span>}
        </div>
        <div className="placeholder-note">
          Weekly NEW-CLIENT leads per office. Capricorn's Datarails export carries no lead figures, so
          this is the only place the leads target can come from — until it is set here, the board is
          pacing against our own headcount estimate and says so under the leaderboard.
          {" "}Saving writes <strong>only</strong> Leads: Applications, Protection and Revenue keep
          whatever the last import gave them.
          <div style={{ marginTop: 4 }}>
            Since 17 Aug 2026 a "lead" is a new CLIENT, not a case — a target set on the older
            all-cases basis will read about 19% too high (new clients run 81–83% of all lead-cases).
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, marginTop: 10 }}>
          <label>
            Effective from (the reporting week's Saturday):{" "}
            <input type="date" value={leadsWeek} onChange={(e) => setLeadsWeek(e.target.value)} />
          </label>
          <table className="lb-table">
            <thead><tr><th>Office</th><th style={{ textAlign: "right" }}>Leads / week</th></tr></thead>
            <tbody>
              {meta.offices.map((o) => (
                <tr key={o.name}>
                  <td className="office-name">{o.name}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      value={leads[o.name] ?? ""}
                      onChange={(e) => setLeads((p) => ({ ...p, [o.name]: e.target.value }))}
                      style={{ width: 90, textAlign: "right" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="lb-total">
                <td className="office-name">All offices</td>
                <td style={{ textAlign: "right" }}><b>{num(leadsTotal)}</b></td>
              </tr>
            </tfoot>
          </table>
          <button className="filter-chip" disabled={savingLeads} onClick={() => void saveLeads()} style={{ alignSelf: "flex-start" }}>
            {savingLeads ? "Saving…" : "Save leads target"}
          </button>
        </div>

        {leadsResult?.ok && (
          <div className="placeholder-note" style={{ marginTop: 10, color: "var(--green)" }}>
            Leads target saved — refreshing…
            {leadsResult.softWarnings && leadsResult.softWarnings.length > 0 && (
              <ul>{leadsResult.softWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
          </div>
        )}
        {leadsResult && !leadsResult.ok && (
          <div style={{ marginTop: 10 }}>
            <div className="alert critical">
              <div className="alert-title">{leadsResult.error ?? "Could not save"}</div>
            </div>
            {leadsResult.hardErrors && leadsResult.hardErrors.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Issue</th></tr></thead>
                <tbody>{leadsResult.hardErrors.map((e) => <tr key={e}><td>{e}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span>Upload Weekly Targets</span></div>
        <div className="placeholder-note">
          Upload Capricorn's consolidated weekly Datarails workbook and pick the week (its Saturday
          column). It sets everything the file carries for that week: <strong>Applications</strong>{" "}
          (Weekly_Par), <strong>Protection</strong> sales/referral pledge (Insurance_Weekly_Target_Number),
          and <strong>Revenue</strong> = written commission (Mortgage + Insurance written sheets).{" "}
          <strong>Leads</strong> is not in this file — set it below. Anything with no data for the
          chosen week is left unchanged rather than zeroed.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, marginTop: 10 }}>
          <label>
            Week (the workbook's Saturday column):{" "}
            <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
          </label>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="filter-chip" disabled={!file || importing} onClick={() => void importDatarails()} style={{ alignSelf: "flex-start" }}>
            {importing ? "Uploading…" : "Upload"}
          </button>
        </div>

        {result?.ok && (
          <div className="placeholder-note" style={{ marginTop: 10, color: "var(--green)" }}>
            Upload successful — refreshing…
            {result.softWarnings && result.softWarnings.length > 0 && (
              <ul>
                {result.softWarnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {result && !result.ok && (
          <div style={{ marginTop: 10 }}>
            <div className="alert critical">
              <div className="alert-title">{result.error ?? "Upload failed"}</div>
            </div>
            {result.hardErrors && result.hardErrors.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Issue</th></tr></thead>
                <tbody>
                  {result.hardErrors.map((e) => <tr key={e}><td>{e}</td></tr>)}
                </tbody>
              </table>
            )}
            {result.softWarnings && result.softWarnings.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Warning</th></tr></thead>
                <tbody>
                  {result.softWarnings.map((w) => <tr key={w}><td>{w}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
