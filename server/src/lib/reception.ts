import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { env } from '../env';
import { SCAN_COOKIE, SCAN_VALID_MINUTES } from '../config/constants';
import { randomToken } from './crypto';

/**
 * The reception QR code. The poster at the desk links to /checkin?k=<code>; opening that link
 * proves the phone was at reception, and unlocks self check-in for SCAN_VALID_MINUTES. The code
 * is only shown to staff (the poster lives in the dashboard) and can be changed if it leaks.
 */
const KEY = 'reception_code';
const AUDIENCE = 'reception-scan';

export async function receptionCode(): Promise<string> {
  const existing = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (existing) return existing.value;
  // upsert so two first requests at once agree on one code.
  const created = await prisma.appSetting.upsert({ where: { key: KEY }, update: {}, create: { key: KEY, value: randomToken(9) } });
  return created.value;
}

export async function changeReceptionCode(): Promise<string> {
  const value = randomToken(9);
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return value;
}

export async function isReceptionCode(code: string): Promise<boolean> {
  const a = Buffer.from(code);
  const b = Buffer.from(await receptionCode());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieOptions() {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/api/public' };
}

export function markScanned(res: Response): void {
  const token = jwt.sign({}, env.JWT_SECRET, { audience: AUDIENCE, expiresIn: `${SCAN_VALID_MINUTES}m` });
  res.cookie(SCAN_COOKIE, token, { ...cookieOptions(), maxAge: SCAN_VALID_MINUTES * 60_000 });
}

export function hasScanned(req: Request): boolean {
  const token: string | undefined = req.cookies?.[SCAN_COOKIE];
  if (!token) return false;
  try {
    jwt.verify(token, env.JWT_SECRET, { audience: AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

/** Whether this request may self check-in as far as the reception scan is concerned. */
export function scanSatisfied(req: Request): boolean {
  return !env.REQUIRE_RECEPTION_SCAN || hasScanned(req);
}
