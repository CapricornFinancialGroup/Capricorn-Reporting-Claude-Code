// Weekly targets upload (item 1, 2026-07-07) — minimal admin page folded into the existing
// dashboard tab nav rather than a 4th surface/mode. Deliberately excluded from KIOSK_PAGE_IDS
// (pages/index.ts) — an upload form has no business on the office wall TVs.

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
 *  Saturday-anchored, and Arman sets targets Monday morning for the week just starting. */
function nextSaturdayIso(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + ((6 - day + 7) % 7));
  return d.toISOString().slice(0, 10);
}

export function Targets({ meta }: PageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const [drFile, setDrFile] = useState<File | null>(null);
  const [drWeek, setDrWeek] = useState(nextSaturdayIso);
  const [drImporting, setDrImporting] = useState(false);
  const [drResult, setDrResult] = useState<UploadResult | null>(null);

  const [wrMortFile, setWrMortFile] = useState<File | null>(null);
  const [wrInsFile, setWrInsFile] = useState<File | null>(null);
  const [wrWeek, setWrWeek] = useState(nextSaturdayIso);
  const [wrImporting, setWrImporting] = useState(false);
  const [wrResult, setWrResult] = useState<UploadResult | null>(null);

  const provenance = meta.targetsProvenance;

  const importDatarails = async () => {
    if (!drFile) return;
    setDrImporting(true);
    setDrResult(null);
    try {
      const body = new FormData();
      body.append("week", drWeek);
      body.append("file", drFile);
      const res = await fetch("/api/targets/import-datarails", { method: "POST", body });
      const json = (await res.json()) as UploadResult;
      if (res.ok && json.ok) {
        setDrResult({ ok: true, softWarnings: json.softWarnings, unmatchedAdvisers: json.unmatchedAdvisers });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setDrResult({ ok: false, error: json.error, hardErrors: json.hardErrors, softWarnings: json.softWarnings });
      }
    } catch (err) {
      setDrResult({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setDrImporting(false);
    }
  };

  const importWritten = async () => {
    if (!wrMortFile || !wrInsFile) return;
    setWrImporting(true);
    setWrResult(null);
    try {
      const body = new FormData();
      body.append("week", wrWeek);
      body.append("mortgage", wrMortFile);
      body.append("insurance", wrInsFile);
      const res = await fetch("/api/targets/import-written", { method: "POST", body });
      const json = (await res.json()) as UploadResult;
      if (res.ok && json.ok) {
        setWrResult({ ok: true, softWarnings: json.softWarnings });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setWrResult({ ok: false, error: json.error, hardErrors: json.hardErrors, softWarnings: json.softWarnings });
      }
    } catch (err) {
      setWrResult({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setWrImporting(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/targets/upload", { method: "POST", body });
      const json = (await res.json()) as UploadResult & { provenance?: unknown };
      if (res.ok && json.ok) {
        setResult({ ok: true, softWarnings: json.softWarnings });
        // meta has no polling (refreshMs=0) — reload so the new provenance/targets actually show.
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult({ ok: false, error: json.error, hardErrors: json.hardErrors, softWarnings: json.softWarnings });
      }
    } catch (err) {
      setResult({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setUploading(false);
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
        <div className="card-title"><span>Upload New Targets</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
          <a href="/api/targets/template" download>Download blank template (.xlsx)</a>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button className="filter-chip" disabled={!file || uploading} onClick={() => void upload()} style={{ alignSelf: "flex-start" }}>
            {uploading ? "Uploading…" : "Upload"}
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

      <div className="card">
        <div className="card-title"><span>Import Applications &amp; Sales from Datarails Export</span></div>
        <div className="placeholder-note">
          Reads Capricorn's own per-adviser Datarails workbook and aggregates Applications
          (Weekly_Par) and Protection Sales (Insurance_Weekly_Target_Number) by office for one
          week. Leads, Referrals and Revenue are left untouched.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, marginTop: 10 }}>
          <label>
            Week (the workbook's Saturday column):{" "}
            <input type="date" value={drWeek} onChange={(e) => setDrWeek(e.target.value)} />
          </label>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setDrFile(e.target.files?.[0] ?? null)}
          />
          <button className="filter-chip" disabled={!drFile || drImporting} onClick={() => void importDatarails()} style={{ alignSelf: "flex-start" }}>
            {drImporting ? "Importing…" : "Import"}
          </button>
        </div>

        {drResult?.ok && (
          <div className="placeholder-note" style={{ marginTop: 10, color: "var(--green)" }}>
            Import successful — refreshing…
            {drResult.softWarnings && drResult.softWarnings.length > 0 && (
              <ul>
                {drResult.softWarnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {drResult && !drResult.ok && (
          <div style={{ marginTop: 10 }}>
            <div className="alert critical">
              <div className="alert-title">{drResult.error ?? "Import failed"}</div>
            </div>
            {drResult.hardErrors && drResult.hardErrors.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Issue</th></tr></thead>
                <tbody>
                  {drResult.hardErrors.map((e) => <tr key={e}><td>{e}</td></tr>)}
                </tbody>
              </table>
            )}
            {drResult.softWarnings && drResult.softWarnings.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Warning</th></tr></thead>
                <tbody>
                  {drResult.softWarnings.map((w) => <tr key={w}><td>{w}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span>Import Written Targets (Revenue)</span></div>
        <div className="placeholder-note">
          Reads Capricorn's "Weekly Mortgage Written" and "Weekly Insurance Written" target files and
          sets the business-wide Revenue target (Mortgage + Insurance) for one week. Actuals come from
          the Total Written report.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, marginTop: 10 }}>
          <label>
            Week (the workbook's Saturday column):{" "}
            <input type="date" value={wrWeek} onChange={(e) => setWrWeek(e.target.value)} />
          </label>
          <label>
            Mortgage written targets (.xlsx):{" "}
            <input type="file" accept=".xlsx" onChange={(e) => setWrMortFile(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            Insurance written targets (.xlsx):{" "}
            <input type="file" accept=".xlsx" onChange={(e) => setWrInsFile(e.target.files?.[0] ?? null)} />
          </label>
          <button
            className="filter-chip"
            disabled={!wrMortFile || !wrInsFile || wrImporting}
            onClick={() => void importWritten()}
            style={{ alignSelf: "flex-start" }}
          >
            {wrImporting ? "Importing…" : "Import"}
          </button>
        </div>

        {wrResult?.ok && (
          <div className="placeholder-note" style={{ marginTop: 10, color: "var(--green)" }}>
            Import successful — refreshing…
            {wrResult.softWarnings && wrResult.softWarnings.length > 0 && (
              <ul>{wrResult.softWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
          </div>
        )}

        {wrResult && !wrResult.ok && (
          <div style={{ marginTop: 10 }}>
            <div className="alert critical">
              <div className="alert-title">{wrResult.error ?? "Import failed"}</div>
            </div>
            {wrResult.hardErrors && wrResult.hardErrors.length > 0 && (
              <table className="lb-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Issue</th></tr></thead>
                <tbody>
                  {wrResult.hardErrors.map((e) => <tr key={e}><td>{e}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
