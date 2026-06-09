/**
 * Normalize a SKU/product code to 8 digits by left-padding with zeros.
 * - Trims whitespace
 * - Strips a leading sign or non-digit prefixes only when the value is purely numeric-like
 * - If length >= 8, returns as-is (trimmed)
 * - Empty / nullish input returns ""
 *
 * Use this at every boundary where SKU codes enter the system (CSV import,
 * Dify agent responses) and before any matching/lookup against system codes.
 */
export function padSkuCode(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input).trim();
  if (!s) return "";
  // Drop a trailing ".0" that appears when Excel coerces codes to numbers
  s = s.replace(/\.0+$/, "");
  if (s.length >= 8) return s;
  // Only pad if the code is composed of digits (after trimming);
  // non-numeric codes are returned unchanged.
  if (!/^\d+$/.test(s)) return s;
  return s.padStart(8, "0");
}
