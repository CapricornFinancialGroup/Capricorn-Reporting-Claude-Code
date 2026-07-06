import { statusLabel } from "../format.js";

/** Ahead / On Pace / Behind / Critical pill — the shared status vocabulary. */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${status}`}>{label ?? statusLabel(status)}</span>;
}
