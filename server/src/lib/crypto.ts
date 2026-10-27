import crypto from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { env } from '../env';

export function normalizeDocNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Keyed hash so that low-entropy ID numbers can't be brute-forced from a DB dump
 * without also having the server secret.
 */
export function hashDocument(type: DocumentType, number: string): string {
  return crypto
    .createHmac('sha256', env.DOC_HASH_SECRET)
    .update(`${type}:${normalizeDocNumber(number)}`)
    .digest('hex');
}

export function docLast4(number: string): string {
  return normalizeDocNumber(number).slice(-4);
}

export function maskDocument(last4: string): string {
  return `****${last4}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashOtp(phone: string, code: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`otp:${phone}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}
