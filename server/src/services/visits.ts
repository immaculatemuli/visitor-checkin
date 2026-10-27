import crypto from 'node:crypto';
import type { CheckInMethod, Prisma, Visit, VisitCategory, Visitor, VisitStatus } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/http';
import { maskDocument } from '../lib/crypto';
import { lastEndOfDay, localDate } from '../lib/time';

export const OPEN_STATUSES: VisitStatus[] = ['PENDING_APPROVAL', 'CHECKED_IN'];

export interface VisitDetails {
  category: VisitCategory;
  department: string;
  hostName?: string;
  purpose?: string;
}

const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function randomPassNumber(now: Date): string {
  const ymd = localDate(now, env.TIMEZONE).replace(/-/g, '').slice(2);
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += PASS_ALPHABET[crypto.randomInt(PASS_ALPHABET.length)];
  return `VIS-${ymd}-${suffix}`;
}

async function uniquePassNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomPassNumber(now);
    const exists = await tx.visit.findUnique({ where: { passNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new Error('Could not allocate a pass number');
}

/**
 * Closes a visit left open from an earlier day (the visitor forgot to check out), so the next
 * day starts with a fresh check-in. It keeps its end-of-day flag, and the check-out time is set
 * to that day's closing time. Returns true if the visit was closed.
 */
export async function closeIfFromEarlierDay(
  tx: Prisma.TransactionClient,
  visit: Visit,
  now = new Date(),
): Promise<boolean> {
  const started = visit.checkInAt ?? visit.createdAt;
  if (visit.status !== 'CHECKED_IN' || localDate(started, env.TIMEZONE) >= localDate(now, env.TIMEZONE)) return false;
  const closing = lastEndOfDay(now, env.TIMEZONE, env.END_OF_DAY_TIME);
  await tx.visit.update({
    where: { id: visit.id },
    data: {
      status: 'CHECKED_OUT',
      checkOutAt: closing > started ? closing : started,
      flagged: true,
      flagReason: visit.flagReason ?? 'Not checked out by end of day',
    },
  });
  return true;
}

/**
 * Opens a visit for a visitor. Serialised per visitor with a row lock so a double tap
 * can't create two open visits. A watchlist match creates the visit as PENDING_APPROVAL.
 */
export async function startVisit(
  visitorId: string,
  details: VisitDetails,
  method: CheckInMethod,
  staffId: string | null = null,
): Promise<{ visit: Visit; visitor: Visitor }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM visitors WHERE id = ${visitorId}::uuid FOR UPDATE`;
    const visitor = await tx.visitor.findUniqueOrThrow({ where: { id: visitorId } });

    const open = await tx.visit.findFirst({ where: { visitorId, status: { in: OPEN_STATUSES } } });
    if (open && !(await closeIfFromEarlierDay(tx, open))) {
      throw new HttpError(409, 'Already checked in. Please check out first.', { passNumber: open.passNumber });
    }

    const watchlisted = await tx.watchlistEntry.findUnique({
      where: { documentNumberHash: visitor.documentNumberHash },
      select: { id: true },
    });

    const now = new Date();
    const visit = await tx.visit.create({
      data: {
        visitorId,
        category: details.category,
        department: details.department,
        hostName: details.category === 'visitor' ? details.hostName : null,
        purpose: details.category === 'visitor' ? details.purpose : null,
        method,
        passNumber: await uniquePassNumber(tx, now),
        status: watchlisted ? 'PENDING_APPROVAL' : 'CHECKED_IN',
        checkInAt: watchlisted ? null : now,
        watchlistHit: Boolean(watchlisted),
        createdById: staffId,
      },
    });
    return { visit, visitor };
  });
}

export async function checkOutVisit(visitId: string, staffId: string | null = null): Promise<Visit> {
  const result = await prisma.visit.updateMany({
    where: { id: visitId, status: 'CHECKED_IN' },
    data: { status: 'CHECKED_OUT', checkOutAt: new Date(), ...(staffId ? { resolvedById: staffId } : {}) },
  });
  if (result.count === 0) throw new HttpError(409, 'This visit is not currently checked in.');
  return prisma.visit.findUniqueOrThrow({ where: { id: visitId } });
}

/** What the visitor sees on their pass. */
export function toPublicVisit(visit: Visit, visitor: Visitor) {
  return {
    passNumber: visit.passNumber,
    status: visit.status,
    category: visit.category,
    visitorName: visitor.fullName,
    documentType: visitor.documentType,
    documentMasked: maskDocument(visitor.documentLast4),
    hostName: visit.hostName,
    department: visit.department,
    purpose: visit.purpose,
    requestedAt: visit.createdAt,
    checkInAt: visit.checkInAt,
    checkOutAt: visit.checkOutAt,
  };
}

/** What staff see in the dashboard. Document numbers are always masked. */
export function toStaffVisit(visit: Visit & { visitor: Visitor }) {
  return {
    id: visit.id,
    ...toPublicVisit(visit, visit.visitor),
    method: visit.method,
    flagged: visit.flagged,
    flagReason: visit.flagReason,
    watchlistHit: visit.watchlistHit,
    visitor: {
      id: visit.visitor.id,
      fullName: visit.visitor.fullName,
      documentType: visit.visitor.documentType,
      documentMasked: maskDocument(visit.visitor.documentLast4),
      nationality: visit.visitor.nationality,
      phone: visit.visitor.phone,
    },
  };
}
