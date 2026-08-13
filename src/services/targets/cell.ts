// Shared cell → number coercion for the Datarails-shaped workbooks (parseDatarails.ts,
// parseWrittenTargets.ts). Both were carrying near-identical copies of this that disagreed about
// which cell shapes they understood, so a figure readable by one parser was invisible to the other.
//
// ExcelJS hands back four shapes for what a human sees as "a number in a cell":
//   • a plain number
//   • a string — Capricorn's export contains "£8,000" contaminated with zero-width spaces
//   • a FORMULA cell, `{formula|sharedFormula, result}`. Excel caches the last computed value in
//     `result`, so a formula pointing at their external Mastersheet workbook is still readable even
//     though we can't resolve the reference ourselves. Both parsers used to drop these entirely,
//     which silently reads as "this week has no data" and leaves the KPI unimported.
//   • a RICH TEXT object, `{richText: [...]}` — a cell that's been part-styled by hand.
//
// Anything else — a blank, an Excel error (`{error: "#REF!"}`), a formula whose cached result is an
// error — is "no figure" (null), never 0: callers distinguish the two, and a spurious 0 would
// overwrite a real target.

interface FormulaCell {
  result?: unknown;
}
interface RichTextCell {
  richText: Array<{ text?: string }>;
}

function isFormulaCell(value: object): value is FormulaCell {
  return "formula" in value || "sharedFormula" in value;
}

function isRichTextCell(value: object): value is RichTextCell {
  return "richText" in value && Array.isArray((value as RichTextCell).richText);
}

/** Coerce one cell to a number, or null when it carries no readable figure. */
export function cellToNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // Strip currency symbols, thousands separators and zero-width spaces.
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (cleaned !== "" && !Number.isNaN(Number(cleaned))) return Number(cleaned);
    return null;
  }
  if (value && typeof value === "object") {
    if (isFormulaCell(value)) return cellToNumber(value.result);
    if (isRichTextCell(value)) return cellToNumber(value.richText.map((r) => r.text ?? "").join(""));
  }
  return null;
}
