// API client + data hook shared by the dashboard and kiosk.
//
// Mode is derived from the URL path: /screens* = kiosk (calls the token-gated /api/kiosk with the
// ?k= token forwarded), anything else = dashboard (/api/reporting/* behind Easy Auth).

import { useEffect, useRef, useState } from "react";

// Three surfaces from one bundle:
//   dashboard  /dashboard  — Easy Auth, tabbed nav, /api/reporting/*
//   wall       /wall       — Easy Auth, auto-rotating (no token), /api/reporting/*
//   kiosk      /screens    — Easy-Auth-excluded, auto-rotating, token-gated /api/kiosk
// "wall" is the rotating view for signed-in users (an office TV that can do interactive login);
// "kiosk" is for unattended TVs that can't, gated by the shared token instead.
export type Mode = "dashboard" | "wall" | "kiosk";

export function detectMode(): Mode {
  const path = window.location.pathname;
  if (path.startsWith("/screens")) return "kiosk";
  if (path.startsWith("/wall")) return "wall";
  return "dashboard";
}

/** Rotating surfaces (full-bleed auto-cycle) vs the interactive tabbed dashboard. */
export function isRotating(mode: Mode): boolean {
  return mode === "kiosk" || mode === "wall";
}

const urlParams = new URLSearchParams(window.location.search);
export const KIOSK_TOKEN = urlParams.get("k") ?? "";

export interface Filters {
  from: string | null;
  to: string | null;
  offices: string[];
}

export const EMPTY_FILTERS: Filters = { from: null, to: null, offices: [] };

export function buildQuery(filters: Filters, mode: Mode): string {
  const q = new URLSearchParams();
  if (filters.from) q.set("from", filters.from);
  if (filters.to) q.set("to", filters.to);
  filters.offices.forEach((o) => q.append("office", o));
  if (mode === "kiosk" && KIOSK_TOKEN) q.set("k", KIOSK_TOKEN);
  return q.toString();
}

export async function fetchDataset<T>(name: string, filters: Filters, mode: Mode): Promise<T> {
  // Kiosk uses a single exact path with the dataset in the query (Easy Auth excludedPaths is
  // exact-match only). Dashboard puts the dataset in the path (behind Easy Auth, sub-paths fine).
  let url: string;
  if (mode === "kiosk") {
    const params = new URLSearchParams(buildQuery(filters, mode));
    params.set("dataset", name);
    url = `/api/kiosk?${params.toString()}`;
  } else {
    const qs = buildQuery(filters, mode);
    url = `/api/reporting/${name}${qs ? `?${qs}` : ""}`;
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${name}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Fetch a dataset on filter change and poll every `refreshMs` (0 = no polling). `filters: null`
 *  skips fetching entirely (e.g. the "Compare to" window before both dates are picked) — respects
 *  the Rules of Hooks (this can't be a conditional hook call at the caller). */
export function usePayload<T>(name: string, filters: Filters | null, mode: Mode, refreshMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(filters != null);
  const key = JSON.stringify(filters);
  const first = useRef(true);

  useEffect(() => {
    if (!filters) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    if (first.current) first.current = false;
    else setLoading(true);
    const load = () =>
      fetchDataset<T>(name, filters, mode)
        .then((d) => {
          if (!active) return;
          setData(d);
          setError(null);
        })
        .catch((e) => active && setError(String(e instanceof Error ? e.message : e)))
        .finally(() => active && setLoading(false));
    load();
    const id = refreshMs ? window.setInterval(load, refreshMs) : undefined;
    return () => {
      active = false;
      if (id) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, mode, refreshMs]);

  return { data, error, loading };
}
