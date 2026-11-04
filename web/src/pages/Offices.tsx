// Adviser Offices admin page: Capricorn place their own advisers. Admin-only, off the wall rotation
// (pages/index.ts). Until 2026-11-04 every placement was an email to Smartr365 and a code deploy.

import { useEffect, useMemo, useState } from "react";
import { num } from "../format.js";
import type { PageProps } from "./common.js";

const UNASSIGNED = "Unassigned";

interface AdviserRow {
  login: string;
  name: string | null;
  cases: number;
  lastCase: string | null;
  office: string;
  seedOffice: string;
  placement: { office: string; team?: string; setBy: string; setAt: string } | null;
}

interface OfficesPayload {
  offices: string[];
  windowDays: number;
  storageConfigured: boolean;
  lastChange: { updatedBy: string; updatedAt: string } | null;
  advisers: AdviserRow[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Row({ row, offices, onSaved }: { row: AdviserRow; offices: string[]; onSaved: () => void }) {
  const [office, setOffice] = useState(row.office === UNASSIGNED ? "" : row.office);
  const [team, setTeam] = useState(row.placement?.team ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = office !== "" && (office !== row.office || team.trim() !== (row.placement?.team ?? ""));

  const send = async (body: { office: string | null; team?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/offices/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: row.login, ...body }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) onSaved();
      else setError(json.error ?? "Could not save.");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <div className="office-name">{row.name ?? row.login}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{row.login}</div>
      </td>
      <td style={{ textAlign: "right" }}>{num(row.cases)}</td>
      <td>{row.lastCase ?? "—"}</td>
      <td>
        {row.office === UNASSIGNED ? <span className="pill behind">Unassigned</span> : row.office}
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {row.placement
            ? `Placed by ${row.placement.setBy}, ${when(row.placement.setAt)}`
            : row.office === UNASSIGNED ? "No office on file" : "From the original mapping"}
        </div>
      </td>
      <td>
        <select value={office} onChange={(e) => setOffice(e.target.value)} disabled={busy}>
          <option value="">Choose an office…</option>
          {offices.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>{" "}
        <input placeholder="Team (optional)" value={team} onChange={(e) => setTeam(e.target.value)} disabled={busy} style={{ width: 130 }} />{" "}
        <button className="filter-chip" disabled={!changed || busy} onClick={() => void send({ office, team: team.trim() || undefined })}>
          {busy ? "Saving…" : "Save"}
        </button>
        {row.placement && (
          <button
            className="filter-chip clear"
            disabled={busy}
            title={`Go back to ${row.seedOffice === UNASSIGNED ? "Unassigned" : row.seedOffice}, as in the original mapping`}
            onClick={() => void send({ office: null })}
          >
            Undo
          </button>
        )}
        {error && <div className="alert critical" style={{ marginTop: 6 }}><div className="alert-title">{error}</div></div>}
      </td>
    </tr>
  );
}

export function Offices(_props: PageProps) {
  const [data, setData] = useState<OfficesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/offices")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        if (live) { setData(json as OfficesPayload); setLoadError(null); }
      })
      .catch((err) => live && setLoadError(String(err instanceof Error ? err.message : err)));
    return () => { live = false; };
  }, [version]);

  const unassigned = data?.advisers.filter((a) => a.office === UNASSIGNED) ?? [];
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.advisers.filter((a) =>
      (showAll || a.office === UNASSIGNED) && (!q || a.login.includes(q) || (a.name ?? "").toLowerCase().includes(q)),
    );
  }, [data, showAll, search]);

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">
          <span>Adviser Offices</span>
          {data && <span className={`pill ${unassigned.length ? "behind" : "ahead"}`}>{unassigned.length} unassigned</span>}
        </div>
        <div className="placeholder-note">
          Choose the office for anyone the board shows under <b>Unassigned</b>. Their figures move to
          that office on every screen as soon as you save, including this week's. Use <b>Show everyone</b>{" "}
          to move an adviser who is in the wrong office, and <b>Undo</b> to go back to the original mapping.
          {data && <> The list covers anyone with a mortgage lead or protection case in the last {data.windowDays} days.</>}
          {data?.lastChange && <div style={{ marginTop: 4 }}>Last change by {data.lastChange.updatedBy}, {when(data.lastChange.updatedAt)}.</div>}
        </div>
        {data && !data.storageConfigured && (
          <div className="alert critical" style={{ marginTop: 10 }}><div className="alert-title">Saving is switched off: no storage is configured.</div></div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
          <button className={`filter-chip ${!showAll ? "on" : ""}`} onClick={() => setShowAll(false)}>Unassigned only</button>
          <button className={`filter-chip ${showAll ? "on" : ""}`} onClick={() => setShowAll(true)}>Show everyone</button>
          <input placeholder="Search name or login" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        </div>

        {loadError && <div className="alert critical"><div className="alert-title">Could not load advisers: {loadError}</div></div>}
        {!data && !loadError && <div className="placeholder-note">Loading advisers…</div>}
        {data && rows.length === 0 && (
          <div className="placeholder-note">{showAll || search ? "No advisers match." : "Nobody is unassigned. Every active adviser has an office."}</div>
        )}
        {data && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="lb-table">
              <thead>
                <tr>
                  <th>Adviser</th>
                  <th style={{ textAlign: "right" }}>Cases ({data.windowDays}d)</th>
                  <th>Last case</th>
                  <th>Office now</th>
                  <th>Change to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  // Keyed on the saved state too, so a row's form resets to what was saved after a reload.
                  <Row key={`${r.login}|${r.office}|${r.placement?.setAt ?? ""}`} row={r} offices={data.offices} onSaved={() => setVersion((v) => v + 1)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
