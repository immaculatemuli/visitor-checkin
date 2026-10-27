/**
 * Normalises a phone number to E.164. Kenyan local formats (07.., 01.., 2547..) are
 * converted to +254; foreign visitors must enter the international form (+44..).
 * Returns null if the number is not plausible.
 */
export function normalizePhone(input: string): string | null {
  const v = input.replace(/[\s\-().]/g, '');
  if (/^0[17]\d{8}$/.test(v)) return `+254${v.slice(1)}`;
  if (/^254[17]\d{8}$/.test(v)) return `+${v}`;
  if (/^\+254[17]\d{8}$/.test(v)) return v;
  if (/^\+(?!254)[1-9]\d{7,14}$/.test(v)) return v;
  return null;
}
