import type { Request, Response } from 'express';
import type { DocumentType, Visitor } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { CONSENT_VERSION, DEVICE_COOKIE, DEVICE_TOKEN_TTL_DAYS } from '../config/constants';
import { docLast4, hashDocument, randomToken, sha256 } from '../lib/crypto';
import { isoToDate } from '../lib/time';

export interface DocumentInput {
  documentType: DocumentType;
  fullName: string;
  documentNumber: string;
  nationality?: string;
  dob?: string;
  documentExpiry?: string;
  phone: string;
}

/** Creates the visitor or refreshes their details if the document has been seen before. */
export async function upsertVisitor(input: DocumentInput): Promise<Visitor> {
  const documentNumberHash = hashDocument(input.documentType, input.documentNumber);
  const data = {
    fullName: input.fullName,
    documentType: input.documentType,
    documentLast4: docLast4(input.documentNumber),
    nationality: input.nationality ?? (input.documentType === 'national_id' ? 'KEN' : null),
    dob: isoToDate(input.dob),
    documentExpiry: isoToDate(input.documentExpiry),
    phone: input.phone,
    consentAt: new Date(),
    consentVersion: CONSENT_VERSION,
  };
  return prisma.visitor.upsert({
    where: { documentNumberHash },
    create: { ...data, documentNumberHash },
    update: data,
  });
}

function deviceCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/api/public',
    maxAge: DEVICE_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
  };
}

export async function issueDeviceToken(res: Response, visitorId: string): Promise<void> {
  const token = randomToken();
  await prisma.deviceToken.create({
    data: {
      tokenHash: sha256(token),
      visitorId,
      expiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  res.cookie(DEVICE_COOKIE, token, deviceCookieOptions());
}

export async function visitorFromDevice(req: Request): Promise<Visitor | null> {
  const token: string | undefined = req.cookies?.[DEVICE_COOKIE];
  if (!token) return null;
  const record = await prisma.deviceToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { visitor: true },
  });
  if (!record || record.expiresAt < new Date()) return null;
  await prisma.deviceToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return record.visitor;
}

export async function forgetDevice(req: Request, res: Response): Promise<void> {
  const token: string | undefined = req.cookies?.[DEVICE_COOKIE];
  if (token) await prisma.deviceToken.deleteMany({ where: { tokenHash: sha256(token) } });
  res.clearCookie(DEVICE_COOKIE, { path: '/api/public' });
}
