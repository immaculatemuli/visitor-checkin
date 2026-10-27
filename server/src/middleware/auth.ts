import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Staff, StaffRole } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/http';
import { STAFF_COOKIE, STAFF_SESSION_HOURS } from '../config/constants';

export interface StaffContext {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffContext;
    }
  }
}

const ISSUER = 'visitor-checkin';

export function setStaffSession(res: Response, staff: Pick<Staff, 'id' | 'role'>): void {
  const token = jwt.sign({ role: staff.role }, env.JWT_SECRET, {
    subject: staff.id,
    issuer: ISSUER,
    expiresIn: `${STAFF_SESSION_HOURS}h`,
  });
  res.cookie(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api',
    maxAge: STAFF_SESSION_HOURS * 3600 * 1000,
  });
}

export function clearStaffSession(res: Response): void {
  res.clearCookie(STAFF_COOKIE, { path: '/api' });
}

export async function requireStaff(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token: string | undefined = req.cookies?.[STAFF_COOKIE];
  if (!token) throw new HttpError(401, 'Please sign in.');

  let subject: string | undefined;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER }) as jwt.JwtPayload;
    subject = payload.sub;
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }

  // Look the account up on every request so deactivation and role changes apply immediately.
  const staff = subject ? await prisma.staff.findUnique({ where: { id: subject } }) : null;
  if (!staff || !staff.active) throw new HttpError(401, 'Please sign in.');

  req.staff = { id: staff.id, name: staff.name, email: staff.email, role: staff.role };
  next();
}

export function requireRole(...roles: StaffRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.staff || !roles.includes(req.staff.role)) {
      throw new HttpError(403, 'You do not have permission to do this.');
    }
    next();
  };
}
