import type { Worker } from 'tesseract.js';
import { parseMrzFromText, type MrzResult } from './mrz';

/**
 * In-browser MRZ OCR. Images never leave the device: frames are drawn to a canvas, read by
 * tesseract.js (WebAssembly), and only the parsed text is kept.
 */

let workerPromise: Promise<Worker> | null = null;

/** Starts downloading and initialising the OCR engine. Safe to call repeatedly. */
export function warmUpOcr(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      user_defined_dpi: '300',
    });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export async function recognizeMrz(canvas: HTMLCanvasElement): Promise<MrzResult | null> {
  const worker = await warmUpOcr();
  const { data } = await worker.recognize(canvas);
  return parseMrzFromText(data.text);
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Copies a region of an image/video to a canvas sized for OCR (about 1000px wide, which keeps
 * MRZ characters near tesseract's preferred height), in greyscale with stretched contrast.
 */
export function prepareCanvas(
  source: CanvasImageSource,
  crop: Crop,
  options: { binarize?: boolean; rotate?: boolean } = {},
): HTMLCanvasElement {
  const scale = Math.min(2, 1000 / crop.w);
  const w = Math.round(crop.w * scale);
  const h = Math.round(crop.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (options.rotate) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
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

/** Fallback for a still photo: tries the likely MRZ regions, cheapest first. */
export async function readMrzFromPhoto(file: File, onProgress?: (fraction: number) => void): Promise<MrzResult | null> {
  const bitmap = await createImageBitmap(file);
  const { width: W, height: H } = bitmap;
  const attempts: { crop: Crop; binarize?: boolean; rotate?: boolean }[] = [
    { crop: { x: 0, y: H * 0.6, w: W, h: H * 0.4 } },
    { crop: { x: 0, y: H * 0.6, w: W, h: H * 0.4 }, binarize: true },
    { crop: { x: 0, y: H * 0.35, w: W, h: H * 0.65 } },
    { crop: { x: 0, y: 0, w: W, h: H * 0.4 }, rotate: true }, // photo taken upside down
  ];
  let best: MrzResult | null = null;
  try {
    for (const [i, attempt] of attempts.entries()) {
      onProgress?.(i / attempts.length);
      const result = await recognizeMrz(prepareCanvas(bitmap, attempt.crop, attempt));
      if (result?.valid) return result;
      best ??= result;
    }
    return best;
  } finally {
    bitmap.close();
  }
}

export function liveCameraSupported(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
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
