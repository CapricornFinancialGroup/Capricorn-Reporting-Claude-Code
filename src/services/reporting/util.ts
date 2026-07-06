// Small numeric helpers shared across the reporting query modules.

/**
 * DAX DIVIDE semantics: return null (Power BI BLANK) when the denominator is 0/empty, so a rate
 * with no base renders blank rather than 0% or NaN. Callers serialise null straight to JSON.
 */
export function divide(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

/** Round to `dp` decimal places (default 1), preserving null. */
export function round(value: number | null, dp = 1): number | null {
  if (value == null) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
