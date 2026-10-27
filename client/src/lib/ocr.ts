import type { Line, PSM, Worker } from 'tesseract.js';
import { combineFrontReads, parseIdFront, parseIdFrontPartial, type FrontField, type IdFront } from './idfront';
import { extractMrzLines, parseMrz, voteMrzLines, type MrzResult } from './mrz';

/**
 * In-browser ID OCR. Images never leave the device: photos are drawn to a canvas, read by
 * tesseract.js (WebAssembly), and only the parsed text is kept.
 */

/** What a photo yielded: the printed front of a Kenyan ID, or the MRZ of an ID back or passport. */
export type ScanResult = { kind: 'front'; front: IdFront; uncertain: FrontField[] } | { kind: 'mrz'; mrz: MrzResult };

const MRZ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

let workerPromise: Promise<Worker> | null = null;

/** Starts downloading and initialising the OCR engine. Safe to call repeatedly. */
export function warmUpOcr(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({ user_defined_dpi: '300' });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/**
 * OCR text of the canvas. `mrz` limits it to the MRZ alphabet, which reads the MRZ far better;
 * the printed front needs every character.
 */
async function recognizeText(canvas: HTMLCanvasElement, { wholeImage, mrz }: { wholeImage: boolean; mrz: boolean }): Promise<string> {
  return (await recognizeWithLines(canvas, { wholeImage, mrz, lines: false })).text;
}

/** OCR text plus, if asked, each text line with its position in the canvas. */
async function recognizeWithLines(
  canvas: HTMLCanvasElement,
  { wholeImage, mrz, lines }: { wholeImage: boolean; mrz: boolean; lines: boolean },
): Promise<{ text: string; lines: Line[] }> {
  const worker = await warmUpOcr();
  // A whole photo has other text around the MRZ, so let tesseract find the text blocks itself.
  await worker.setParameters({
    tessedit_pageseg_mode: wholeImage ? PSM_AUTO : PSM_SINGLE_BLOCK,
    tessedit_char_whitelist: mrz ? MRZ_CHARS : '',
  });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: lines });
  return { text: data.text, lines: (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) };
}

/** The MRZ lines OCR finds in the canvas, or null if there is no MRZ in it. */
async function recognizeMrzLines(canvas: HTMLCanvasElement, wholeImage: boolean): Promise<string[] | null> {
  return extractMrzLines(await recognizeText(canvas, { wholeImage, mrz: true }))?.lines ?? null;
}

function tryParse(lines: string[]): MrzResult | null {
  try {
    return parseMrz(lines);
  } catch {
    return null;
  }
}

// Numeric values of tesseract's PSM enum, so the main bundle doesn't import tesseract.js eagerly.
const PSM_AUTO = '3' as PSM;
const PSM_SINGLE_BLOCK = '6' as PSM;

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clockwise quarter turns: 1 for a document photographed sideways, 2 for upside down. */
export type Turns = 0 | 1 | 2 | 3;

/**
 * Copies a region of an image to a canvas sized for OCR (`width` px across once rotated, which
 * keeps MRZ characters near tesseract's preferred height), in greyscale with stretched contrast.
 */
export function prepareCanvas(
  source: CanvasImageSource,
  crop: Crop,
  options: { binarize?: boolean; turns?: Turns; tilt?: number; width?: number } = {},
): HTMLCanvasElement {
  const turns = options.turns ?? 0;
  const sideways = turns % 2 === 1;
  const scale = Math.min(2, (options.width ?? 1000) / (sideways ? crop.h : crop.w));
  const w = Math.round((sideways ? crop.h : crop.w) * scale);
  const h = Math.round((sideways ? crop.w : crop.h) * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(w / 2, h / 2);
  // `tilt` straightens a document held a few degrees off level; OCR struggles with slanted lines.
  ctx.rotate((turns * Math.PI) / 2 + ((options.tilt ?? 0) * Math.PI) / 180);
  const [dw, dh] = [crop.w * scale, crop.h * scale];
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, -dw / 2, -dh / 2, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const grey = new Uint8ClampedArray(w * h);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < grey.length; i++) {
    const g = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) | 0;
    grey[i] = g;
    histogram[g]++;
  }

  // Stretch the 2nd-98th percentile to full range so dim or washed-out photos still read.
  const lo = percentile(histogram, grey.length, 0.02);
  const hi = Math.max(lo + 1, percentile(histogram, grey.length, 0.98));
  const threshold = options.binarize ? otsu(histogram, grey.length) : -1;
  for (let i = 0; i < grey.length; i++) {
    let v = ((grey[i] - lo) * 255) / (hi - lo);
    if (threshold >= 0) v = grey[i] > threshold ? 255 : 0;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

interface Attempt {
  crop: Crop;
  turns?: Turns;
  binarize?: boolean;
  whole?: boolean;
  tilt?: number;
}

const FRONT_WIDTH = 1600;

/**
 * The part of the photo the text sits in, in photo pixels, from the lines OCR found in a canvas
 * made by prepareCanvas(bitmap, full photo, look). Null when the text already fills most of the
 * photo, so zooming in wouldn't help.
 */
function textRegion(lines: Line[], canvas: HTMLCanvasElement, photo: Crop, look: Look): Crop | null {
  const solid = lines.filter((l) => l.confidence >= 50 && l.text.replace(/[^A-Za-z0-9]/g, '').length >= 3);
  if (solid.length < 2) return null;
  const box = solid.reduce(
    (b, l) => ({ x0: Math.min(b.x0, l.bbox.x0), y0: Math.min(b.y0, l.bbox.y0), x1: Math.max(b.x1, l.bbox.x1), y1: Math.max(b.y1, l.bbox.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  if ((box.x1 - box.x0) * (box.y1 - box.y0) > canvas.width * canvas.height * 0.5) return null;

  // Undo prepareCanvas's scale and quarter turns to map the box corners back onto the photo.
  const turns = look.turns ?? 0;
  const scale = canvas.width / (turns % 2 ? photo.h : photo.w);
  const angle = (-turns * Math.PI) / 2;
  const corners = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x0, box.y1],
    [box.x1, box.y1],
  ].map(([x, y]) => {
    const [dx, dy] = [x - canvas.width / 2, y - canvas.height / 2];
    return [
      (dx * Math.cos(angle) - dy * Math.sin(angle)) / scale + photo.w / 2,
      (dx * Math.sin(angle) + dy * Math.cos(angle)) / scale + photo.h / 2,
    ];
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  // Generous padding: lines OCR missed (often the ID number) are usually just outside the box.
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.15;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.25;
  const x = Math.max(0, Math.min(...xs) - padX);
  const y = Math.max(0, Math.min(...ys) - padY);
  return { x, y, w: Math.min(photo.w, Math.max(...xs) + padX) - x, h: Math.min(photo.h, Math.max(...ys) + padY) - y };
}

/** What reading a photo produced, plus the text OCR saw, to show when nothing could be read. */
export interface PhotoRead {
  result: ScanResult | null;
  seen: string;
}

/**
 * Reads an ID from a photo of either side, taken any way up. A first full read of the photo
 * shows which side it is and where the card is. A card that's small in the photo (held at a
 * comfortable distance from the phone) is then read again zoomed in from the full-resolution
 * photo. The printed front is parsed from its labels; the back of an ID or a passport page goes
 * to the MRZ reader. If only some front fields can be read, those are returned for the visitor
 * to complete.
 */
export async function readIdFromPhoto(file: File, onProgress?: (fraction: number) => void): Promise<PhotoRead> {
  const bitmap = await createImageBitmap(file);
  const { width: W, height: H } = bitmap;
  const full = { x: 0, y: 0, w: W, h: H };
  // Upright first, then a high-contrast copy, then the other ways a photo can be turned.
  const looks: Look[] = [
    {},
    { binarize: true },
    ...(W >= H ? [2, 1, 3] : [1, 3, 2]).map((turns) => ({ turns: turns as Turns })),
  ];
  const readArea = (crop: Crop) => (look: Look) =>
    recognizeText(prepareCanvas(bitmap, crop, { ...look, width: look.width ?? FRONT_WIDTH }), { wholeImage: true, mrz: false });

  let seen = '';
  let partial: IdFront | null = null;
  let sawMrz = false;
  try {
    for (const [i, look] of looks.entries()) {
      onProgress?.((i / looks.length) * 0.5);
      const canvas = prepareCanvas(bitmap, full, { ...look, width: FRONT_WIDTH });
      const whole = await recognizeWithLines(canvas, { wholeImage: true, mrz: false, lines: true });
      seen ||= whole.text;
      // MRZ text means it's the back of the card or a passport page.
      if (extractMrzLines(whole.text)) {
        sawMrz = true;
        break;
      }

      const region = textRegion(whole.lines, canvas, full, look);
      const zoomed = region ? await readArea(region)(look) : null;
      const texts = zoomed ? [zoomed, whole.text] : [whole.text];
      const fronts = texts.map(parseIdFront).filter((f): f is IdFront => f !== null);
      if (fronts.length) {
        onProgress?.(0.6);
        // More reads from different views (zoomed or whole, plain or high contrast), so one
        // view's misreading can't confirm itself.
        const more = [() => readArea(region ?? full)({ ...look, binarize: !look.binarize })];
        if (fronts.length < 2) more.push(() => readArea(full)({ ...look, binarize: false, width: 2200 }));
        return { result: { kind: 'front', ...(await confirmFront(fronts, more, () => onProgress?.(0.85))) }, seen };
      }
      for (const text of texts) {
        const some = parseIdFrontPartial(text);
        if (some && (!partial || filled(some) > filled(partial))) partial = some;
      }
      if (zoomed && extractMrzLines(zoomed)) {
        sawMrz = true;
        break;
      }
    }
    if (sawMrz || !partial) {
      const mrz = await readMrz(bitmap, (f) => onProgress?.(0.5 + f / 2));
      if (mrz) return { result: { kind: 'mrz', mrz }, seen };
    }
    // Some of the front was readable: let the visitor fill in the rest.
    return partial ? { result: { kind: 'front', front: partial, uncertain: ['fullName', 'idNumber', 'dateOfBirth'] }, seen } : { result: null, seen };
  } finally {
    bitmap.close();
  }
}

function filled(front: IdFront): number {
  return [front.fullName, front.idNumber, front.dateOfBirth].filter(Boolean).length;
}

interface Look {
  turns?: Turns;
  binarize?: boolean;
  width?: number;
}

/**
 * The front has no check digits, so one read is never trusted alone: the reads so far are
 * combined with further reads of the photo. Fields the reads don't all agree on are returned as
 * uncertain.
 */
async function confirmFront(
  reads: IdFront[],
  more: (() => Promise<string>)[],
  onRead: () => void,
): Promise<{ front: IdFront; uncertain: FrontField[] }> {
  const all = [...reads];
  for (const read of more) {
    const again = parseIdFront(await read());
    onRead();
    if (again) all.push(again);
  }
  return combineFrontReads(all);
}

/**
 * Reads the MRZ from a photo taken any way up: the document may fill the frame or sit in the
 * middle of it, upright, sideways or upside down. Tries the likeliest layouts first and stops at
 * the first fully valid read. Otherwise the reads are combined character by character, since a
 * digit misread in one read is usually right in the others, and the best result is returned.
 */
async function readMrz(bitmap: ImageBitmap, onProgress?: (fraction: number) => void): Promise<MrzResult | null> {
  const { width: W, height: H } = bitmap;
  const full = { x: 0, y: 0, w: W, h: H };
  const bottom = { x: 0, y: H * 0.5, w: W, h: H * 0.5 };
  const top = { x: 0, y: 0, w: W, h: H * 0.5 };
  const right = { x: W * 0.5, y: 0, w: W * 0.5, h: H };
  const left = { x: 0, y: 0, w: W * 0.5, h: H };

  // A landscape photo is usually the card upright; a portrait one is a card held level in the
  // middle of the frame, or a card turned sideways to fill it.
  const attempts: Attempt[] =
    W >= H
      ? [
          { crop: bottom },
          { crop: full, whole: true },
          { crop: bottom, binarize: true },
          { crop: top, turns: 2 },
          { crop: full, whole: true, turns: 1 },
          { crop: full, whole: true, turns: 3 },
          { crop: full, whole: true, tilt: -5 },
          { crop: full, whole: true, tilt: 5 },
        ]
      : [
          { crop: full, whole: true },
          { crop: right, turns: 1 },
          { crop: left, turns: 3 },
          { crop: full, whole: true, binarize: true },
          { crop: full, whole: true, turns: 2 },
          { crop: full, whole: true, tilt: -5 },
          { crop: full, whole: true, tilt: 5 },
        ];

  const reads: string[][] = [];
  for (const [i, attempt] of attempts.entries()) {
    onProgress?.(i / attempts.length);
    const canvas = prepareCanvas(bitmap, attempt.crop, {
      turns: attempt.turns,
      tilt: attempt.tilt,
      binarize: attempt.binarize,
      width: attempt.whole ? 1400 : 1000,
    });
    const lines = await recognizeMrzLines(canvas, !!attempt.whole);
    if (!lines) continue;
    const result = tryParse(lines);
    if (result?.valid) return result;
    reads.push(lines);
    // Once two reads of the same layout exist, a vote may already settle it.
    const same = reads.filter((r) => r[0].length === lines[0].length);
    if (same.length >= 2) {
      const voted = tryParse(voteMrzLines(same));
      if (voted?.valid) return voted;
    }
  }

  const candidates = reads.map(tryParse).filter((r): r is MrzResult => r !== null);
  for (const length of [30, 44]) {
    const same = reads.filter((r) => r[0].length === length);
    if (same.length >= 2) {
      const voted = tryParse(voteMrzLines(same));
      if (voted) candidates.push(voted);
    }
  }
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** How many check digits passed, to keep the best of several partial reads. */
function score(result: MrzResult): number {
  return Object.values(result.checks).filter(Boolean).length;
}

function percentile(histogram: number[], total: number, p: number): number {
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += histogram[i];
    if (acc >= total * p) return i;
  }
  return 255;
}

function otsu(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}
