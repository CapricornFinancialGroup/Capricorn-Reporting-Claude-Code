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
}

export function Targets({ meta }: PageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const provenance = meta.targetsProvenance;

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
          Weekly Revenue target: {gbpCompact(meta.targets.revenueDaily * 5)}. All figures above are weekly.
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
    </div>
  );
}
