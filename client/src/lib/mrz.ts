/**
 * ICAO 9303 machine-readable zone parsing for:
 *  - TD1 (3 lines x 30): Kenyan national ID cards (Maisha card and the older card)
 *  - TD3 (2 lines x 44): passports
 *
 * Pure functions with no browser APIs so they can be unit tested. OCR lives in ./ocr.ts.
 */

export type MrzFormat = 'TD1' | 'TD3';

export interface MrzResult {
  format: MrzFormat;
  documentCode: string;
  issuingCountry: string;
  documentNumber: string;
  /** For Kenyan IDs: the national ID number, which may differ from the card serial number. */
  idNumber: string;
  surname: string;
  givenNames: string;
  fullName: string;
  nationality: string;
  dateOfBirth: string | null; // YYYY-MM-DD
  sex: 'M' | 'F' | 'X';
  expiryDate: string | null; // YYYY-MM-DD
  optionalData: string;
  checks: {
    documentNumber: boolean;
    dateOfBirth: boolean;
    expiryDate: boolean;
    composite: boolean;
  };
  /** True when every check digit matches. */
  valid: boolean;
}

const LINE_LENGTH: Record<MrzFormat, number> = { TD1: 30, TD3: 44 };
const WEIGHTS = [7, 3, 1];

function charValue(c: string): number {
  if (c === '<') return 0;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0;
}

export function checkDigit(field: string): string {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += charValue(field[i]) * WEIGHTS[i % 3];
  return String(sum % 10);
}

function verify(field: string, digit: string): boolean {
  // A filler '<' is a valid check digit for an empty (all '<') field.
  if (digit === '<') return /^<*$/.test(field);
  return checkDigit(field) === digit;
}

// OCR commonly confuses these in fields that can only contain digits.
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
// ...and these in fields that can only contain letters.
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G' };

function digitsOnly(s: string): string {
  return s.replace(/[A-Z]/g, (c) => TO_DIGIT[c] ?? c);
}
function lettersOnly(s: string): string {
  return s.replace(/[0-9]/g, (c) => TO_LETTER[c] ?? c);
}
function trimFiller(s: string): string {
  return s.replace(/<+$/g, '').replace(/</g, ' ').trim();
}

/** YYMMDD to YYYY-MM-DD. Birth dates never lie in the future; expiry dates are assumed 20xx. */
export function parseMrzDate(yymmdd: string, kind: 'birth' | 'expiry', now = new Date()): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  let year: number;
  if (kind === 'birth') {
    const currentYY = now.getUTCFullYear() % 100;
    year = yy > currentYY ? 1900 + yy : 2000 + yy;
  } else {
    year = yy >= 70 ? 1900 + yy : 2000 + yy;
  }
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return date.toISOString().slice(0, 10);
}

function parseNames(field: string): { surname: string; givenNames: string } {
  const cleaned = lettersOnly(field);
  const sep = cleaned.indexOf('<<');
  if (sep === -1) return { surname: trimFiller(cleaned), givenNames: '' };
  return { surname: trimFiller(cleaned.slice(0, sep)), givenNames: trimFiller(cleaned.slice(sep + 2)) };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function parseSex(c: string): 'M' | 'F' | 'X' {
  return c === 'M' || c === 'F' ? c : 'X';
}

function finish(partial: Omit<MrzResult, 'fullName' | 'valid'>): MrzResult {
  const fullName = titleCase([partial.givenNames, partial.surname].filter(Boolean).join(' '));
  const valid = Object.values(partial.checks).every(Boolean);
  return { ...partial, fullName, valid };
}

/** Finds the national ID number in a Kenyan card's optional data: the first run of 6-10 digits. */
function kenyanIdNumber(optional: string): string | null {
  const match = optional.replace(/</g, ' ').match(/\b\d{6,10}\b/);
  return match ? match[0] : null;
}

function parseTD1(lines: string[], now: Date): MrzResult {
  const [l1, l2, l3] = lines;
  const issuingCountry = lettersOnly(l1.slice(2, 5));

  // Document numbers longer than 9 characters overflow into the optional data, with '<' at position 15.
  let documentNumber = l1.slice(5, 14);
  let docCheck = l1[14];
  let optional1 = l1.slice(15, 30);
  if (docCheck === '<' && /[A-Z0-9]/.test(optional1[0] ?? '')) {
    const overflow = optional1.slice(0, optional1.indexOf('<') === -1 ? undefined : optional1.indexOf('<'));
    documentNumber += overflow.slice(0, -1);
    docCheck = overflow.slice(-1);
    optional1 = optional1.slice(overflow.length);
  }

  const dob = digitsOnly(l2.slice(0, 6));
  const dobCheck = digitsOnly(l2[6]);
  const expiryRaw = l2.slice(8, 14);
  const expiry = expiryRaw === '<<<<<<' ? expiryRaw : digitsOnly(expiryRaw);
  const expiryCheck = l2[14] === '<' ? '<' : digitsOnly(l2[14]);
  const optional2 = l2.slice(18, 29);
  const composite = digitsOnly(l2[29]);
  const compositeField = l1.slice(5, 30) + dob + dobCheck + expiry + expiryCheck + optional2;

  const isKenyan = issuingCountry === 'KEN' || issuingCountry === 'KYA';
  const docNumberClean = documentNumber.replace(/</g, '');

  return finish({
    format: 'TD1',
    documentCode: l1.slice(0, 2).replace(/</g, ''),
    issuingCountry,
    documentNumber: docNumberClean,
    idNumber: (isKenyan && (kenyanIdNumber(optional1) ?? kenyanIdNumber(optional2))) || docNumberClean,
    ...parseNames(l3),
    // Older Kenyan IDs use the non-standard code KYA.
    nationality: lettersOnly(l2.slice(15, 18)).replace('KYA', 'KEN').replace(/</g, ''),
    dateOfBirth: parseMrzDate(dob, 'birth', now),
    sex: parseSex(l2[7]),
    expiryDate: parseMrzDate(expiry, 'expiry', now),
    optionalData: (optional1 + optional2).replace(/</g, ' ').trim(),
    checks: {
      documentNumber: verify(documentNumber, docCheck),
      dateOfBirth: verify(dob, dobCheck),
      expiryDate: verify(expiry, expiryCheck),
      composite: verify(compositeField, composite),
    },
  });
}

function parseTD3(lines: string[], now: Date): MrzResult {
  const [l1, l2] = lines;
  const documentNumber = l2.slice(0, 9);
  const docCheck = digitsOnly(l2[9]);
  const dob = digitsOnly(l2.slice(13, 19));
  const dobCheck = digitsOnly(l2[19]);
  const expiry = digitsOnly(l2.slice(21, 27));
  const expiryCheck = digitsOnly(l2[27]);
  const personal = l2.slice(28, 42);
  const personalCheck = l2[42];
  const composite = digitsOnly(l2[43]);
  const compositeField = documentNumber + docCheck + dob + dobCheck + expiry + expiryCheck + personal + personalCheck;
  const docNumberClean = documentNumber.replace(/</g, '');

  return finish({
    format: 'TD3',
    documentCode: l1.slice(0, 2).replace(/</g, ''),
    issuingCountry: lettersOnly(l1.slice(2, 5)),
    documentNumber: docNumberClean,
    idNumber: docNumberClean,
    ...parseNames(l1.slice(5)),
    nationality: lettersOnly(l2.slice(10, 13)).replace(/</g, ''),
    dateOfBirth: parseMrzDate(dob, 'birth', now),
    sex: parseSex(l2[20]),
    expiryDate: parseMrzDate(expiry, 'expiry', now),
    optionalData: personal.replace(/</g, ' ').trim(),
    checks: {
      documentNumber: verify(documentNumber, docCheck),
      dateOfBirth: verify(dob, dobCheck),
      // Personal number check is folded into composite; an all-filler field may use '<' or '0'.
      expiryDate: verify(expiry, expiryCheck),
      composite: verify(compositeField, composite),
    },
  });
}

function normaliseLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/[«‹(\[{]/g, '<')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '');
}

function fitLength(line: string, length: number): string {
  return line.length >= length ? line.slice(0, length) : line + '<'.repeat(length - line.length);
}

/**
 * Pulls MRZ lines out of noisy OCR text. Tolerates a few missing or extra characters per line,
 * which tesseract commonly produces around the edges.
 */
export function extractMrzLines(text: string): { format: MrzFormat; lines: string[] } | null {
  const candidates = text
    .split(/\r?\n/)
    .map(normaliseLine)
    .filter((l) => l.length >= 24 && (l.match(/</g)?.length ?? 0) >= 1);

  // Passport: a line starting with P followed by a ~44-character data line.
  for (let i = 0; i < candidates.length - 1; i++) {
    const [a, b] = [candidates[i], candidates[i + 1]];
    if (a[0] === 'P' && a.length >= 40 && a.length <= 48 && b.length >= 40 && b.length <= 48) {
      return { format: 'TD3', lines: [fitLength(a, 44), fitLength(b, 44)] };
    }
  }
  // ID card: three ~30-character lines, the first starting with I, A or C.
  for (let i = 0; i < candidates.length - 2; i++) {
    const group = candidates.slice(i, i + 3);
    if (/^[IAC]/.test(group[0]) && group.every((l) => l.length >= 26 && l.length <= 34)) {
      return { format: 'TD1', lines: group.map((l) => fitLength(l, 30)) };
    }
  }
  return null;
}

/** Parses MRZ lines (already split) into fields. Throws if the shape is not TD1 or TD3. */
export function parseMrz(lines: string[], now = new Date()): MrzResult {
  const cleaned = lines.map(normaliseLine).filter(Boolean);
  if (cleaned.length === 3 && cleaned.every((l) => l.length === LINE_LENGTH.TD1)) return parseTD1(cleaned, now);
  if (cleaned.length === 2 && cleaned.every((l) => l.length === LINE_LENGTH.TD3)) return parseTD3(cleaned, now);
  throw new Error('Unrecognised MRZ format');
}

/** OCR text in, parsed MRZ out (or null if no MRZ could be found). */
export function parseMrzFromText(text: string, now = new Date()): MrzResult | null {
  const found = extractMrzLines(text);
  return found ? parseMrz(found.lines, now) : null;
}

export function isExpired(expiryDate: string | null, now = new Date()): boolean {
  if (!expiryDate) return false;
  return expiryDate < now.toISOString().slice(0, 10);
}
