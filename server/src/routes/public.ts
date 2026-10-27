import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import {
  CONSENT_VERSION,
  DEPARTMENTS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_WINDOW,
  OTP_TTL_MINUTES,
  OTP_WINDOW_MINUTES,
} from '../config/constants';
import { hashOtp, randomDigits, safeEqualHex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { sendSms } from '../lib/sms';
import { checkInLimiter, otpLimiter } from '../middleware/security';
import { newCheckInSchema, phoneSchema, visitDetailsSchema } from '../schemas';
import { checkOutVisit, closeIfFromEarlierDay, OPEN_STATUSES, startVisit, toPublicVisit } from '../services/visits';
import { forgetDevice, issueDeviceToken, upsertVisitor, visitorFromDevice } from '../services/visitors';

export const publicRouter = Router();

publicRouter.get('/config', (_req, res) => {
  res.json({
    orgName: env.ORG_NAME,
    departments: DEPARTMENTS,
    consentVersion: CONSENT_VERSION,
    retentionMonths: env.RETENTION_MONTHS,
    dpoContact: env.DPO_CONTACT,
  });
});

async function requireVisitor(req: Parameters<typeof visitorFromDevice>[0]) {
  const visitor = await visitorFromDevice(req);
  if (!visitor) throw new HttpError(401, 'We could not recognise this phone. Please check in again.');
  return visitor;
}

/** Who is this device? Used to decide between the first-visit and returning-visitor screens. */
publicRouter.get('/me', async (req, res) => {
  const visitor = await visitorFromDevice(req);
  if (!visitor) {
    res.json({ visitor: null });
    return;
  }
  let openVisit = await prisma.visit.findFirst({ where: { visitorId: visitor.id, status: { in: OPEN_STATUSES } } });
  // Yesterday's forgotten check-out shouldn't greet them today with "Check out".
  if (openVisit && (await closeIfFromEarlierDay(prisma, openVisit))) openVisit = null;
  const lastVisit = await prisma.visit.findFirst({ where: { visitorId: visitor.id }, orderBy: { createdAt: 'desc' } });
  res.json({
    visitor: { fullName: visitor.fullName, firstName: visitor.fullName.split(' ')[0] },
    openVisit: openVisit ? toPublicVisit(openVisit, visitor) : null,
    lastVisitDetails: lastVisit
      ? {
          category: lastVisit.category,
          department: lastVisit.department,
          hostName: lastVisit.hostName,
          purpose: lastVisit.purpose,
        }
      : null,
  });
});

publicRouter.post('/checkin', checkInLimiter, async (req, res) => {
  const input = newCheckInSchema.parse(req.body);
  const visitor = await upsertVisitor(input);
  const { visit } = await startVisit(visitor.id, input, 'SELF');
  await issueDeviceToken(res, visitor.id);
  res.status(visit.status === 'PENDING_APPROVAL' ? 202 : 201).json({ visit: toPublicVisit(visit, visitor) });
});

publicRouter.post('/checkin/returning', checkInLimiter, async (req, res) => {
  const visitor = await requireVisitor(req);
  const details = visitDetailsSchema.parse(req.body);
  const { visit } = await startVisit(visitor.id, details, 'RETURNING');
  res.status(visit.status === 'PENDING_APPROVAL' ? 202 : 201).json({ visit: toPublicVisit(visit, visitor) });
});

publicRouter.post('/checkout', checkInLimiter, async (req, res) => {
  const visitor = await requireVisitor(req);
  const open = await prisma.visit.findFirst({ where: { visitorId: visitor.id, status: { in: OPEN_STATUSES } } });
  if (!open) throw new HttpError(409, 'You are not checked in.');
  if (open.status === 'PENDING_APPROVAL') {
    throw new HttpError(409, 'Your check-in is waiting for security. Please see the security desk.');
  }
  const visit = await checkOutVisit(open.id);
  res.json({ visit: toPublicVisit(visit, visitor) });
});

/** The pass for the open visit, or the most recent one so a checked-out pass still shows its times. */
publicRouter.get('/pass', async (req, res) => {
  const visitor = await requireVisitor(req);
  const visit =
    (await prisma.visit.findFirst({ where: { visitorId: visitor.id, status: { in: OPEN_STATUSES } } })) ??
    (await prisma.visit.findFirst({ where: { visitorId: visitor.id }, orderBy: { createdAt: 'desc' } }));
  if (!visit) throw new HttpError(404, 'No visit found.');
  res.json({ visit: toPublicVisit(visit, visitor) });
});

publicRouter.post('/forget', async (req, res) => {
  await forgetDevice(req, res);
  res.status(204).end();
});

publicRouter.post('/otp/request', otpLimiter, async (req, res) => {
  const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
  // Same response whether or not the number is known, so the endpoint can't be used to probe numbers.
  const generic = { message: 'If this number is registered, you will receive a code by SMS shortly.' };

  const visitor = await prisma.visitor.findFirst({ where: { phone }, select: { id: true } });
  if (!visitor) {
    res.json(generic);
    return;
  }

  const recent = await prisma.otpCode.count({
    where: { phone, createdAt: { gte: new Date(Date.now() - OTP_WINDOW_MINUTES * 60_000) } },
  });
  if (recent >= OTP_MAX_PER_WINDOW) {
    throw new HttpError(429, 'Too many codes requested for this number. Please wait a few minutes.');
  }

  const code = randomDigits(6);
  await prisma.otpCode.create({
    data: { phone, codeHash: hashOtp(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) },
  });
  await sendSms(phone, `Your visitor check-in code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);
  res.json(generic);
});

publicRouter.post('/otp/verify', otpLimiter, async (req, res) => {
  const { phone, code } = z
    .object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })
    .parse(req.body);

  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const invalid = new HttpError(400, 'That code is incorrect or has expired.');
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw invalid;

  if (!safeEqualHex(otp.codeHash, hashOtp(phone, code))) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  const visitor = await prisma.visitor.findFirst({ where: { phone }, orderBy: { updatedAt: 'desc' } });
  if (!visitor) throw invalid;
  await issueDeviceToken(res, visitor.id);
  res.json({ visitor: { fullName: visitor.fullName, firstName: visitor.fullName.split(' ')[0] } });
});
