import { describe, expect, it } from 'vitest';
import { checkDigit, extractMrzLines, isExpired, parseMrz, parseMrzDate, parseMrzFromText } from './mrz';

const NOW = new Date('2026-10-27T09:00:00Z');

// Synthetic samples in the ICAO 9303 layout with correct check digits (not real people).
const MAISHA_CARD = [
  'IDKENA000123453<<12345678<<<<<',
  '9001158F3301155KEN<<<<<<<<<<<4',
  'WANJIKU<<GRACE<AKINYI<<<<<<<<<',
];
const OLD_KENYAN_ID = [
  'IDKYA2012345672<<23456789<<<<<',
  '8507044M<<<<<<0KYA<<<<<<<<<<<6',
  'OTIENO<<BRIAN<KIPKORIR<<<<<<<<',
];
const KENYAN_PASSPORT = [
  'P<KENKAMAU<<JOHN<MWANGI<<<<<<<<<<<<<<<<<<<<<',
  'AK12345678KEN8806231M3106224<<<<<<<<<<<<<<00',
];
const EXPIRED_PASSPORT = [
  'P<UGANAKATO<<SARAH<<<<<<<<<<<<<<<<<<<<<<<<<<',
  'B1234567<3UGA9203103F2403096<<<<<<<<<<<<<<08',
];
// Official ICAO 9303 specimens.
const ICAO_TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const ICAO_TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];

describe('checkDigit', () => {
  it('matches the ICAO 9303 worked examples', () => {
    expect(checkDigit('L898902C3')).toBe('6');
    expect(checkDigit('740812')).toBe('2');
    expect(checkDigit('120415')).toBe('9');
    expect(checkDigit('<<<<<<')).toBe('0');
  });
});

describe('parseMrzDate', () => {
  it('puts birth dates in the past century when needed', () => {
    expect(parseMrzDate('900115', 'birth', NOW)).toBe('1990-01-15');
    expect(parseMrzDate('050301', 'birth', NOW)).toBe('2005-03-01');
  });
  it('treats expiry dates as 20xx', () => {
    expect(parseMrzDate('330115', 'expiry', NOW)).toBe('2033-01-15');
  });
  it('rejects impossible dates', () => {
    expect(parseMrzDate('900231', 'birth', NOW)).toBeNull();
    expect(parseMrzDate('<<<<<<', 'expiry', NOW)).toBeNull();
  });
});

describe('Kenyan national ID (TD1)', () => {
  it('parses a Maisha card', () => {
    const r = parseMrz(MAISHA_CARD, NOW);
    expect(r).toMatchObject({
      format: 'TD1',
      documentCode: 'ID',
      issuingCountry: 'KEN',
      documentNumber: 'A00012345',
      idNumber: '12345678',
      surname: 'WANJIKU',
      givenNames: 'GRACE AKINYI',
      fullName: 'Grace Akinyi Wanjiku',
      nationality: 'KEN',
      dateOfBirth: '1990-01-15',
      sex: 'F',
      expiryDate: '2033-01-15',
      valid: true,
    });
  });

  it('parses the older ID card (KYA code, no expiry)', () => {
    const r = parseMrz(OLD_KENYAN_ID, NOW);
    expect(r).toMatchObject({
      issuingCountry: 'KYA',
      nationality: 'KEN',
      documentNumber: '201234567',
      idNumber: '23456789',
      fullName: 'Brian Kipkorir Otieno',
      dateOfBirth: '1985-07-04',
      sex: 'M',
      expiryDate: null,
      valid: true,
    });
  });

  it('parses the ICAO TD1 specimen', () => {
    const r = parseMrz(ICAO_TD1, NOW);
    expect(r).toMatchObject({ documentNumber: 'D23145890', fullName: 'Anna Maria Eriksson', valid: true });
  });

  it('flags a misread check digit instead of silently accepting it', () => {
    const tampered = [MAISHA_CARD[0], MAISHA_CARD[1].replace('9001158', '9001168'), MAISHA_CARD[2]];
    const r = parseMrz(tampered, NOW);
    expect(r.checks.dateOfBirth).toBe(false);
    expect(r.valid).toBe(false);
  });
});

describe('passport (TD3)', () => {
  it('parses a Kenyan passport', () => {
    const r = parseMrz(KENYAN_PASSPORT, NOW);
    expect(r).toMatchObject({
      format: 'TD3',
      documentCode: 'P',
      issuingCountry: 'KEN',
      documentNumber: 'AK1234567',
      fullName: 'John Mwangi Kamau',
      nationality: 'KEN',
      dateOfBirth: '1988-06-23',
      sex: 'M',
      expiryDate: '2031-06-22',
      valid: true,
    });
    expect(isExpired(r.expiryDate, NOW)).toBe(false);
  });

  it('parses the ICAO TD3 specimen and detects that it has expired', () => {
    const r = parseMrz(ICAO_TD3, NOW);
    expect(r).toMatchObject({
      documentNumber: 'L898902C3',
      nationality: 'UTO',
      dateOfBirth: '1974-08-12',
      expiryDate: '2012-04-15',
      optionalData: 'ZE184226B',
      valid: true,
    });
    expect(isExpired(r.expiryDate, NOW)).toBe(true);
  });

  it('detects an expired passport with a short document number', () => {
    const r = parseMrz(EXPIRED_PASSPORT, NOW);
    expect(r).toMatchObject({ documentNumber: 'B1234567', nationality: 'UGA', expiryDate: '2024-03-09', valid: true });
    expect(isExpired(r.expiryDate, NOW)).toBe(true);
  });
});

describe('reading MRZ from OCR output', () => {
  it('finds the passport MRZ among other text and fixes common OCR mistakes', () => {
    const ocr = [
      'REPUBLIC OF KENYA',
      'PASSPORT',
      'P<KENKAMAU<<JOHN<MWANGI<<<<<<<<<<<<<<<<<<<<',  // one filler short
      'AK12345678KEN88O6231M31O6224<<<<<<<<<<<<<<00', // O instead of 0 in dates
    ].join('\n');
    const r = parseMrzFromText(ocr, NOW);
    expect(r).not.toBeNull();
    expect(r!.dateOfBirth).toBe('1988-06-23');
    expect(r!.expiryDate).toBe('2031-06-22');
    expect(r!.valid).toBe(true);
  });

  it('finds a TD1 MRZ with spaces and « characters', () => {
    const ocr = [
      'IDKENA000123453«<12345678<<<<<',
      '9001158F3301155KEN <<<<<<<<<<<4',
      'WANJIKU<<GRACE<AKINYI<<<<<<<<<',
    ].join('\n');
    const found = extractMrzLines(ocr);
    expect(found?.format).toBe('TD1');
    expect(parseMrz(found!.lines, NOW).idNumber).toBe('12345678');
  });

  it('returns null when there is no MRZ', () => {
    expect(parseMrzFromText('JAMHURI YA KENYA\nREPUBLIC OF KENYA', NOW)).toBeNull();
  });

  it('throws on malformed input', () => {
    expect(() => parseMrz(['ABC', 'DEF'], NOW)).toThrow();
  });
});
