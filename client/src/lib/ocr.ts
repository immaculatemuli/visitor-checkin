import type { PSM, Worker } from 'tesseract.js';
import { parseMrzFromText, type MrzResult } from './mrz';

/**
 * In-browser MRZ OCR. Images never leave the device: frames are drawn to a canvas, read by
 * tesseract.js (WebAssembly), and only the parsed text is kept.
 */

let workerPromise: Promise<Worker> | null = null;

/** Starts downloading and initialising the OCR engine. Safe to call repeatedly. */
export function warmUpOcr(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      user_defined_dpi: '300',
    });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export async function recognizeMrz(canvas: HTMLCanvasElement, wholeImage = false): Promise<MrzResult | null> {
  const worker = await warmUpOcr();
  // A whole photo has other text around the MRZ, so let tesseract find the text blocks itself.
  await worker.setParameters({ tessedit_pageseg_mode: wholeImage ? PSM_AUTO : PSM_SINGLE_BLOCK });
  const { data } = await worker.recognize(canvas);
  return parseMrzFromText(data.text);
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
  options: { binarize?: boolean; turns?: Turns; width?: number } = {},
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
  ctx.rotate((turns * Math.PI) / 2);
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
}

/**
 * Reads the MRZ from a photo taken any way up: the document may fill the frame or sit in the
 * middle of it, upright, sideways or upside down. Tries the likeliest layouts first and stops at
 * the first fully valid read.
 */
export async function readMrzFromPhoto(file: File, onProgress?: (fraction: number) => void): Promise<MrzResult | null> {
  const bitmap = await createImageBitmap(file);
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
        ]
      : [
          { crop: full, whole: true },
          { crop: right, turns: 1 },
          { crop: left, turns: 3 },
          { crop: full, whole: true, binarize: true },
          { crop: full, whole: true, turns: 2 },
        ];

  let best: MrzResult | null = null;
  try {
    for (const [i, attempt] of attempts.entries()) {
      onProgress?.(i / attempts.length);
      const canvas = prepareCanvas(bitmap, attempt.crop, {
        turns: attempt.turns,
        binarize: attempt.binarize,
        width: attempt.whole ? 1400 : 1000,
      });
      const result = await recognizeMrz(canvas, attempt.whole);
      if (result?.valid) return result;
      if (result && (!best || score(result) > score(best))) best = result;
    }
    return best;
  } finally {
    bitmap.close();
  }
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
