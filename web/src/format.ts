// Formatting helpers + the shared colour palette (CSM colours come from the meta payload).

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-GB");
}

/** A rate stored as a fraction (0.2) → "20.0%"; null → "—". */
export function pct(fraction: number | null | undefined, dp = 1): string {
  if (fraction == null) return "—";
  return `${(fraction * 100).toFixed(dp)}%`;
}

/** A signed delta fraction → "+20%" / "−8%" / "—". */
export function delta(fraction: number | null | undefined): string {
  if (fraction == null) return "—";
  const sign = fraction >= 0 ? "+" : "−";
  return `${sign}${Math.abs(fraction * 100).toFixed(0)}%`;
}

/** A signed integer for pace deltas → "+8" / "−2" / "0". */
export function signed(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-GB")}`;
}

/** A signed percentage-point delta from a fraction → "+4pp" / "−15pp". */
export function signedPp(fraction: number | null | undefined): string {
  if (fraction == null) return "—";
  const pp = Math.round(fraction * 100);
  if (pp === 0) return "0pp";
  return `${pp > 0 ? "+" : "−"}${Math.abs(pp)}pp`;
}

/** ISO date → "17 Mar 2027". */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function deltaClass(fraction: number | null | undefined): string {
  if (fraction == null) return "delta-flat";
  if (fraction > 0.001) return "delta-up";
  if (fraction < -0.001) return "delta-down";
  return "delta-flat";
}

/** £ with thousands separators → "£288,750"; null → "—". */
export function gbp(n: number | null | undefined): string {
  if (n == null) return "—";
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/** Compact £ → "£288.8k" / "£1.87M"; null → "—". */
export function gbpCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `£${(n / 1_000).toFixed(1)}k`;
  return `£${Math.round(n)}`;
}

/** ISO date → "Jul 5" (chase-chart axis + data-as-of stamps). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** ISO timestamp → "11:14" in the viewer's own timezone. Stamps a figure with the load that
 *  produced it: the share reloads 5× daily, so "how old is this?" is a real question on the wall. */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Status → display text the strawman uses on pills. */
export function statusLabel(status: string): string {
  switch (status) {
    case "ahead": return "▲ Ahead";
    case "on_pace": return "● On Pace";
    case "behind": return "▼ Behind";
    case "critical": return "⚠ Critical";
    default: return status;
  }
}

/** Stable palette for categorical series. */
export const PALETTE = [
  "#118DFF", "#1AAB40", "#D9B300", "#1B998B", "#FF7F48",
  "#003D5B", "#8A5CF6", "#E0529C", "#6B7280", "#00B7C3",
];

export function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}
