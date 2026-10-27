/**
 * Reads the printed fields on the front of a Kenyan national ID from OCR text. Works from the
 * labels rather than fixed positions, so it covers both the older ID (SERIAL NUMBER / ID NUMBER /
 * FULL NAMES / DATE OF BIRTH) and the Maisha card (SURNAME / GIVEN NAMES / ID NUMBER / DATE OF
 * BIRTH). The front has no check digits, so the visitor confirms what was read.
 */

export interface IdFront {
  fullName: string;
  idNumber: string;
  /** YYYY-MM-DD, or null if not found. */
  dateOfBirth: string | null;
}

// Label patterns, tolerant of the usual OCR slips (1/l/| for I, 0 for O, missing spaces).
// Stray symbols (\ ~ | and the like) can appear between the words of a label.
const ID_LABEL = /[I1L|{[(!]\W?D\W*(?:NUMBER|NUMB[E3]R|N[O0]\.?|NUM)\b/;
// When OCR drops the "ID" of the label: a NUMBER label that isn't the card's SERIAL NUMBER.
const NUMBER_LABEL = /(?<!SERIAL\W*)\bNUMBER\b/;
const FULL_NAMES = /FULL\W*NAMES?/;
const SURNAME = /SUR\W*NAME/;
const GIVEN_NAMES = /(?:GIVEN|OTHER|FIRST)\W*NAMES?/;
const DOB_LABEL = /DATE\W*[O0]F\W*BIRTH/;
// Other labels that can sit between a label and its value; never a name.
const ANY_LABEL =
  /\b(?:SERIAL|NUMBER|DATE|BIRTH|SEX|GENDER|DISTRICT|PLACE|ISSUE|EXPIRY|SIGN|HOLDER|NATIONALITY|REPUBLIC|KENYA|JAMHURI|COUNTY|SUB-?COUNTY|LOCATION|DIVISION|CARD|NAMES?|SURNAME)\b/;
// Where a value that shares its line with the next label ends.
const NEXT_LABEL = /\b(?=SERIAL|DATE|SEX|DISTRICT|I\s?D\s?NUMBER)/;

// Within a number, OCR mistakes letters that look like digits...
const TO_DIGIT: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };
// ...and within a name, characters that look like letters.
const TO_LETTER: Record<string, string> = { '!': 'I', '|': 'I', ']': 'I', '[': 'I', '1': 'I', '0': 'O', '5': 'S', '8': 'B' };

function normalise(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/[^\S\r\n]+/g, ' ').trim())
    .filter(Boolean);
}

function asNumber(token: string): string | null {
  const digits = token.replace(/./g, (c) => TO_DIGIT[c] ?? c);
  // Mostly real digits, so a word like "SOLD" isn't taken for a number.
  const real = (token.match(/\d/g) ?? []).length;
  return /^\d{6,10}$/.test(digits) && real >= digits.length - 2 ? digits : null;
}

/**
 * The first 6–10 digit number in the text, allowing look-alike letters. A number OCR split in
 * two ("2345 6789") is joined; dates and stray symbols such as "|" are never part of it.
 */
function findIdNumber(s: string): string | null {
  const tokens = s
    .split(/\s+/)
    .map((t) => t.replace(/^[^0-9A-Z]+|[^0-9A-Z]+$/g, ''))
    .filter((t) => t && !/[./-]/.test(t));
  for (let i = 0; i < tokens.length; i++) {
    const alone = asNumber(tokens[i]);
    if (alone) return alone;
    if (i + 1 < tokens.length && tokens[i].length >= 2 && tokens[i + 1].length >= 2) {
      const joined = asNumber(tokens[i] + tokens[i + 1]);
      if (joined) return joined;
    }
  }
  return null;
}

function findDate(s: string): string | null {
  const m = s.match(/\b(\d{1,2})\s?[./\-, ]\s?(\d{1,2})\s?[./\-, ]\s?((?:19|20)\d{2})\b/);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > new Date()) return null;
  return date.toISOString().slice(0, 10);
}

/** Reads name words from a value: each word 3+ letters, and at least `minWords` of them. */
function nameReader(minWords: number) {
  return (s: string): string | null => {
    const words = s
      .split(/\s+/)
      .map((w) => (/[A-Z]/.test(w) ? w.replace(/[!|\][1058]/g, (c) => TO_LETTER[c]) : w))
      .map((w) => w.replace(/[^A-Z'-]/g, ''))
      .filter((w) => w.replace(/[^A-Z]/g, '').length >= 3);
    return words.length >= minWords ? words.join(' ') : null;
  };
}

/**
 * The value for a label: the text after the label on the same line if it qualifies, otherwise
 * the next line or two that qualify.
 */
function valueFor<T>(lines: string[], label: RegExp, read: (s: string) => T | null, isName = false): T | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const rest = lines[i].slice((m.index ?? 0) + m[0].length).replace(/^[\s:.;,-]+/, '');
    // On the old ID, SERIAL NUMBER and ID NUMBER share a line: stop at the next label.
    const sameLine = rest.split(NEXT_LABEL)[0];
    const here = sameLine && (!isName || !ANY_LABEL.test(sameLine)) ? read(sameLine) : null;
    if (here) return here;
    for (const next of lines.slice(i + 1, i + 3)) {
      if (isName && ANY_LABEL.test(next)) continue;
      const value = read(next);
      if (value) return value;
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
}

/** Fields from the front of a Kenyan ID, or null if the text isn't one. */
export function parseIdFront(text: string): IdFront | null {
  const lines = normalise(text);
  const idNumber = valueFor(lines, ID_LABEL, findIdNumber) ?? valueFor(lines, NUMBER_LABEL, findIdNumber);

  let name = valueFor(lines, FULL_NAMES, nameReader(2), true);
  if (!name) {
    const surname = valueFor(lines, SURNAME, nameReader(1), true);
    const given = valueFor(lines, GIVEN_NAMES, nameReader(1), true);
    name = surname && given ? `${given} ${surname}` : null;
  }
  const dateOfBirth = valueFor(lines, DOB_LABEL, findDate);

  // Without the ID number and a name it isn't a usable read.
  if (!idNumber || !name) return null;
  return { fullName: titleCase(name), idNumber, dateOfBirth };
}

export type FrontField = keyof IdFront;

/**
 * Combines several reads of the same card field by field, taking the value most reads agree on.
 * A field is certain only when every read that found it agrees (and there were at least two);
 * otherwise it's listed as uncertain so the visitor checks it.
 *
 * OCR drops digits far more often than it invents them, so a read of the ID number that is
 * contained in a longer read ("2345678" in "12345678") counts as a vote for the longer one.
 */
export function combineFrontReads(reads: IdFront[]): { front: IdFront; uncertain: FrontField[] } {
  const fields: FrontField[] = ['fullName', 'idNumber', 'dateOfBirth'];
  const front = { ...reads[0] };
  const uncertain: FrontField[] = [];
  for (const field of fields) {
    const values = reads.map((r) => r[field]).filter((v): v is string => !!v);
    const votes = (v: string) =>
      values.filter((o) => o === v || (field === 'idNumber' && o.length < v.length && v.includes(o))).length;
    let best: string | null = reads[0][field];
    for (const v of values) if (!best || votes(v) > votes(best)) best = v;
    (front as Record<FrontField, string | null>)[field] = best;
    const unanimous = values.length >= 2 && values.every((v) => v === best);
    if (!best || !unanimous) uncertain.push(field);
  }
  return { front, uncertain };
}
