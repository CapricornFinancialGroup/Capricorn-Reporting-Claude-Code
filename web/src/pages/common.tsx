import type { ReactNode } from "react";
import type { Filters, Mode } from "../api.js";
import type { Meta } from "../types.js";
import { ErrorNote } from "../components/ui.js";

export interface PageProps {
  meta: Meta;
  filters: Filters;
  mode: Mode;
  refreshMs: number;
}

/** Standard async wrapper: shows an error note, else the children once data is present. */
export function Load({ error, data, children }: { error: string | null; data: unknown; children: ReactNode }) {
  if (error) return <ErrorNote message={error} />;
  if (data == null) return <div className="loading">Loading…</div>;
  return <>{children}</>;
}
