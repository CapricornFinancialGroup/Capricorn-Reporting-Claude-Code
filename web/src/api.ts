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

/**
 * RELOAD THE PAGE WHEN THE SERVER HAS MOVED ON — the wall's self-refresh.
 *
 * The wall runs unattended for weeks at a time, so until now a deploy only reached it if somebody
 * walked up to the TV and forced a refresh. Nobody does. That is how Capricorn spent 30 July reading
 * a two-day-old build while being told the fix was live, and how I screenshotted a pre-fix page on
 * 1 September and believed it.
 *
 * `serverSha` is the commit the SERVER is on (from `meta`, polled every few minutes anyway).
 * `window.__BUILD_SHA__` is the commit this PAGE was served with, injected at serve time by
 * server/static.ts. Stamped at serve time rather than baked into the bundle on purpose: a cached
 * index.html then carries the sha of whenever it was cached, so this catches a stale CACHE as well
 * as a stale tab.
 *
 * Reloads AT MOST ONCE per page, guarded by a ref. Without that, a server whose sha never matches —
 * a half-finished deploy, two instances behind one hostname mid-swap — would put the wall into a
 * reload loop, which is worse than a stale screen because it never displays anything at all.
 *
 * Does nothing when either side is unknown: dev has no stamp, and reloading on a null would refresh
 * the wall forever.
 */
export function useStaleBuildReload(serverSha: string | null | undefined): void {
  const reloaded = useRef(false);
  useEffect(() => {
    const pageSha = (window as unknown as { __BUILD_SHA__?: string }).__BUILD_SHA__;
    if (!serverSha || !pageSha || serverSha === pageSha || reloaded.current) return;
    reloaded.current = true;
    // `true` is a no-op in modern browsers, so bust the cache explicitly rather than trusting a
    // plain reload to fetch a fresh shell — a cached shell would reload straight back into the same
    // stale build and burn the one-shot guard for nothing.
    const url = new URL(window.location.href);
    url.searchParams.set("b", serverSha.slice(0, 7));
    window.location.replace(url.toString());
  }, [serverSha]);
}
