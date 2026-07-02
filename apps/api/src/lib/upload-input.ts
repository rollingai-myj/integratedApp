/**
 * Shared normalization for user-uploaded files.
 */

export function normalizeSkuCode(raw: string): string {
  const value = raw.trim();
  if (/^\d{7}$/.test(value)) return `0${value}`;
  return value;
}

export function decodeUploadFileName(originalName: string | null | undefined, fallback: string): string {
  const name = originalName && originalName.trim() ? originalName : fallback;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}
