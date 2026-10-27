import { describe, expect, it } from 'vitest';
import { combineFrontReads, parseIdFront } from './idfront';

// OCR-style text of ID fronts (synthetic people), including typical noise.
const OLD_ID = `JAMHURI YA KENYA   REPUBLIC OF KENYA
SERIAL NUMBER: 236512345    ID NUMBER: 23456789
FULL NAMES
BRIAN KIPKORIR OTIENO
DATE OF BIRTH
04.07.1985
SEX
MALE
DISTRICT OF BIRTH
NAKURU
PLACE OF ISSUE
NAIROBI
DATE OF ISSUE
12.03.2015
HOLDER'S SIGN.`;

const MAISHA = `REPUBLIC OF KENYA
NATIONAL IDENTITY CARD
SURNAME
WANJIKU
GIVEN NAMES
GRACE AKINYI
SEX            DATE OF BIRTH
F              15.01.1990
PLACE OF BIRTH
NAIROBI
DATE OF EXPIRY
15.01.2033
ID NUMBER
12345678`;

describe('ID front', () => {
  it('reads the older ID, taking the ID number and not the serial number', () => {
    expect(parseIdFront(OLD_ID)).toEqual({ fullName: 'Brian Kipkorir Otieno', idNumber: '23456789', dateOfBirth: '1985-07-04' });
  });

  it('reads a Maisha card with surname and given names', () => {
    expect(parseIdFront(MAISHA)).toEqual({ fullName: 'Grace Akinyi Wanjiku', idNumber: '12345678', dateOfBirth: '1990-01-15' });
  });

  it('copes with common OCR slips in labels and digits', () => {
    const noisy = `SERlAL NUMBER 236512345  1D NUMBER: 2345 67B9
FULL NAMES: BRIAN KIPKORIR OTIENO
DATE 0F BIRTH 04/07/1985`;
    expect(parseIdFront(noisy)).toEqual({ fullName: 'Brian Kipkorir Otieno', idNumber: '23456789', dateOfBirth: '1985-07-04' });
  });

  it('skips a label line between the label and the name', () => {
    const text = `ID NO. 12345678\nFULL NAMES\nDATE OF BIRTH\nGRACE AKINYI WANJIKU\n15.01.1990`;
    expect(parseIdFront(text)?.fullName).toBe('Grace Akinyi Wanjiku');
  });

  // Actual OCR output from the test photos.
  it('reads real OCR text of the older ID, ignoring stray symbols beside the number', () => {
    const ocr =
      "JAMHURI YA KENYA REPUBLIC OF KENYA\n\nSERIAL NUMBER36512345.\nIDNUMBER: 23456789 |\nFULLNAMES | ¢ Lo\nBRIAN KIPKORIR OTIENO\n\nDATE OF BIRTH SEX\n04.07.1985 ~~ = MALE\nDISTRICT OF BIRTH |\nNAKURU\n";
    expect(parseIdFront(ocr)).toEqual({ fullName: 'Brian Kipkorir Otieno', idNumber: '23456789', dateOfBirth: '1985-07-04' });
  });

  it('reads the older ID when OCR drops the "ID" of the label, without taking the serial number', () => {
    const ocr = 'SERIAL NUMBEZ36512345\nNUMBER, 23456789 |\n[FULL NAmES | |] | |\nBRIAN KIPKORIR OTIENO\n\nDATE OF BIRTH \\SEX\n04.07.1985 | = | MALE\n';
    expect(parseIdFront(ocr)).toMatchObject({ idNumber: '23456789', fullName: 'Brian Kipkorir Otieno' });
  });

  it('reads real OCR text of a Maisha card, with the ID number beside the expiry date', () => {
    const ocr =
      'REPUBLIC OF KENYA\n\nSURNAME\nWANJIKU\n\n[GIVEN NAMES | |\n/GRACE AKINY! |\n\nSEX DATE OF BIRTH\n\nFo 15. 01. 1990 |\n\nPLACE OF BIRTH |\n\nNAIROBI /\n\nIDATE OF EXPIRY | ID NUMBER\n15.01.2033 12345678 |\n';
    expect(parseIdFront(ocr)).toEqual({ fullName: 'Grace Akinyi Wanjiku', idNumber: '12345678', dateOfBirth: '1990-01-15' });
  });

  it('reads a dim Maisha photo with odd label characters', () => {
    const ocr = 'SURNAME\n| WANJIKU\n\\ GIVEN NAMES\nGRACE AKINY]\nSEX DATE OF BIRTH\nF 15.01.1990\nDATE OF EXPIRY {D NUMBER\n15.01.2033 12345678\n';
    expect(parseIdFront(ocr)).toEqual({ fullName: 'Grace Akinyi Wanjiku', idNumber: '12345678', dateOfBirth: '1990-01-15' });
    const sideways = 'DATE \\OF BIRTH SEX\n\n| 04.07.1985 | | MALE\nID NUMBER: 23456789\nFULL NAMES\nBRIAN KIPKORIR OTIENO';
    expect(parseIdFront(sideways)?.dateOfBirth).toBe('1985-07-04');
  });

  it('trusts a field only when two reads agree, and flags the rest', () => {
    const good = { fullName: 'Grace Akinyi Wanjiku', idNumber: '12345678', dateOfBirth: '1990-01-15' };
    const misread = { fullName: 'Grace Akinyi Wanjiku', idNumber: '2345678', dateOfBirth: '1990-01-05' };
    expect(combineFrontReads([good, good, good])).toEqual({ front: good, uncertain: [] });
    // Outvoted, but still flagged because the reads didn't all agree.
    expect(combineFrontReads([misread, good, good])).toEqual({ front: good, uncertain: ['idNumber', 'dateOfBirth'] });
    expect(combineFrontReads([good]).uncertain).toEqual(['fullName', 'idNumber', 'dateOfBirth']);
  });

  it('prefers the longer ID number when another read dropped a digit', () => {
    const full = { fullName: 'Grace Akinyi Wanjiku', idNumber: '12345678', dateOfBirth: '1990-01-15' };
    const dropped = { ...full, idNumber: '2345678' };
    const { front, uncertain } = combineFrontReads([dropped, dropped, full]);
    expect(front.idNumber).toBe('12345678');
    expect(uncertain).toEqual(['idNumber']);
  });

  it('returns null for text that is not an ID front', () => {
    expect(parseIdFront('IDKENA000123453<<12345678<<<<<\n9001158F3301155KEN<<<<<<<<<<<4')).toBeNull();
    expect(parseIdFront('HELLO WORLD')).toBeNull();
  });

  it('leaves the birth date empty rather than guessing when it is unreadable', () => {
    const text = `ID NUMBER 12345678\nFULL NAMES\nGRACE AKINYI WANJIKU\nDATE OF BIRTH\n1S.O1.199O`;
    expect(parseIdFront(text)).toMatchObject({ idNumber: '12345678', dateOfBirth: null });
  });
});
