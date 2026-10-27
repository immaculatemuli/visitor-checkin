import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Visit, Visitor } from '@prisma/client';
import { VisitCategory, VisitStatus } from '@prisma/client';
import { prisma } from '../../db';
import { env } from '../../env';
import { EXPORT_MAX_ROWS } from '../../config/constants';
import { audit } from '../../lib/audit';
import { hashDocument, maskDocument, normalizeDocNumber } from '../../lib/crypto';
import { type Column, sendCsv, sendPdf } from '../../lib/export';
import { HttpError } from '../../lib/http';
import { addDays, formatDateTime, localDate, zonedToUtc } from '../../lib/time';
import { isoDate, manualCheckInSchema } from '../../schemas';
import { checkOutVisit, startVisit, toStaffVisit } from '../../services/visits';
import { upsertVisitor } from '../../services/visitors';

export const visitsRouter = Router();

type VisitWithVisitor = Visit & { visitor: Visitor };

const filtersSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  name: z.string().trim().max(100).optional(),
  document: z.string().trim().max(20).optional(),
  department: z.string().trim().max(100).optional(),
  status: z.enum(VisitStatus).optional(),
  category: z.enum(VisitCategory).optional(),
  flagged: z.enum(['true']).optional(),
});

const listSchema = filtersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

type Filters = z.infer<typeof filtersSchema>;

function buildWhere(f: Filters): Prisma.VisitWhereInput {
  const and: Prisma.VisitWhereInput[] = [];
  if (f.from) and.push({ createdAt: { gte: zonedToUtc(f.from, '00:00', env.TIMEZONE) } });
  if (f.to) and.push({ createdAt: { lt: zonedToUtc(addDays(f.to, 1), '00:00', env.TIMEZONE) } });
  if (f.name) and.push({ visitor: { fullName: { contains: f.name, mode: 'insensitive' } } });
  if (f.document) {
    const n = normalizeDocNumber(f.document);
    // Full numbers are matched by hash; 4 characters or fewer match the stored last digits.
    and.push(
      n.length <= 4
        ? { visitor: { documentLast4: { endsWith: n } } }
        : { visitor: { documentNumberHash: { in: [hashDocument('national_id', n), hashDocument('passport', n)] } } },
    );
  }
  if (f.department) and.push({ department: f.department });
  if (f.status) and.push({ status: f.status });
  if (f.category) and.push({ category: f.category });
  if (f.flagged) and.push({ flagged: true });
  return { AND: and };
}

function describeFilters(f: Filters): string {
  const parts = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => (k === 'document' ? `document: ****${normalizeDocNumber(String(v)).slice(-4)}` : `${k}: ${v}`));
  return parts.length ? parts.join(' · ') : 'All visits';
}

visitsRouter.get('/stats', async (_req, res) => {
  const startOfToday = zonedToUtc(localDate(new Date(), env.TIMEZONE), '00:00', env.TIMEZONE);
  const [visitorsInside, attacheesInside, pending, today, flagged] = await Promise.all([
    prisma.visit.count({ where: { status: 'CHECKED_IN', category: 'visitor' } }),
    prisma.visit.count({ where: { status: 'CHECKED_IN', category: 'attachee' } }),
    prisma.visit.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.visit.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.visit.count({ where: { status: 'CHECKED_IN', flagged: true } }),
  ]);
  res.json({ visitorsInside, attacheesInside, pending, today, flagged });
});

visitsRouter.get('/live', async (_req, res) => {
  const visits = await prisma.visit.findMany({
    where: { status: { in: ['CHECKED_IN', 'PENDING_APPROVAL'] } },
    include: { visitor: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    pending: visits.filter((v) => v.status === 'PENDING_APPROVAL').map(toStaffVisit),
    inside: visits.filter((v) => v.status === 'CHECKED_IN').map(toStaffVisit),
  });
});

visitsRouter.get('/', async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = buildWhere(q);
  const [total, visits] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      include: { visitor: true },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  if (q.document) await audit(req, 'SEARCH_BY_DOCUMENT', { last4: normalizeDocNumber(q.document).slice(-4) });
  res.json({ total, page: q.page, pageSize: q.pageSize, visits: visits.map(toStaffVisit) });
});

const exportColumns: Column<VisitWithVisitor>[] = [
  { header: 'Pass', value: (v) => v.passNumber, width: 82 },
  { header: 'Name', value: (v) => v.visitor.fullName, width: 110 },
  { header: 'Type', value: (v) => (v.category === 'attachee' ? 'Attachee' : 'Visitor'), width: 50 },
  { header: 'Document', value: (v) => `${v.visitor.documentType === 'passport' ? 'Passport' : 'ID'} ${maskDocument(v.visitor.documentLast4)}`, width: 72 },
  { header: 'Phone', value: (v) => v.visitor.phone, width: 80 },
  { header: 'Department', value: (v) => v.department, width: 90 },
  { header: 'Host', value: (v) => v.hostName ?? '', width: 75 },
  { header: 'Purpose', value: (v) => v.purpose ?? '' },
  { header: 'Status', value: (v) => v.status.replace('_', ' ') + (v.flagged ? ' (FLAGGED)' : ''), width: 70 },
  { header: 'Time in', value: (v) => formatDateTime(v.checkInAt, env.TIMEZONE), width: 78 },
  { header: 'Time out', value: (v) => formatDateTime(v.checkOutAt, env.TIMEZONE), width: 78 },
];

visitsRouter.get('/export/:format', async (req, res) => {
  const format = z.enum(['csv', 'pdf']).parse(req.params.format);
  const filters = filtersSchema.parse(req.query);
  const visits = await prisma.visit.findMany({
    where: buildWhere(filters),
    include: { visitor: true },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_MAX_ROWS,
  });
  await audit(req, 'EXPORT_VISITS', { format, rows: visits.length, filters: describeFilters(filters) });

  const stamp = localDate(new Date(), env.TIMEZONE);
  if (format === 'csv') {
    sendCsv(res, `visits-${stamp}.csv`, exportColumns, visits);
  } else {
    const subtitle = `${describeFilters(filters)} · ${visits.length} record(s) · generated ${formatDateTime(new Date(), env.TIMEZONE)} by ${req.staff!.name}`;
    const title = env.ORG_NAME ? `${env.ORG_NAME} - Visitor log` : 'Visitor log';
    sendPdf(res, `visits-${stamp}.pdf`, title, subtitle, exportColumns, visits);
  }
});

visitsRouter.get('/pass/:passNumber', async (req, res) => {
  const passNumber = z.string().trim().toUpperCase().max(30).parse(req.params.passNumber);
  const visit = await prisma.visit.findUnique({ where: { passNumber }, include: { visitor: true } });
  if (!visit) throw new HttpError(404, 'No visit with that pass number.');
  res.json({ visit: toStaffVisit(visit) });
});

visitsRouter.post('/manual', async (req, res) => {
  const input = manualCheckInSchema.parse(req.body);
  const visitor = await upsertVisitor(input);
  const { visit } = await startVisit(visitor.id, input, 'MANUAL', req.staff!.id);
  await audit(req, 'MANUAL_CHECK_IN', { passNumber: visit.passNumber, watchlistHit: visit.watchlistHit });
  res.status(201).json({ visit: toStaffVisit({ ...visit, visitor }) });
});

const idParam = z.object({ id: z.string().uuid() });

visitsRouter.post('/:id/approve', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const result = await prisma.visit.updateMany({
    where: { id, status: 'PENDING_APPROVAL' },
    data: { status: 'CHECKED_IN', checkInAt: new Date(), resolvedById: req.staff!.id },
  });
  if (result.count === 0) throw new HttpError(409, 'This visit is not awaiting approval.');
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id }, include: { visitor: true } });
  await audit(req, 'APPROVE_WATCHLIST_VISIT', { passNumber: visit.passNumber });
  res.json({ visit: toStaffVisit(visit) });
});

visitsRouter.post('/:id/deny', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  const result = await prisma.visit.updateMany({
    where: { id, status: 'PENDING_APPROVAL' },
    data: { status: 'DENIED', resolvedById: req.staff!.id, flagReason: reason || 'Entry denied by security' },
  });
  if (result.count === 0) throw new HttpError(409, 'This visit is not awaiting approval.');
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id }, include: { visitor: true } });
  await audit(req, 'DENY_WATCHLIST_VISIT', { passNumber: visit.passNumber, reason });
  res.json({ visit: toStaffVisit(visit) });
});

visitsRouter.post('/:id/checkout', async (req, res) => {
  const { id } = idParam.parse(req.params);
  await checkOutVisit(id, req.staff!.id);
  const visit = await prisma.visit.findUniqueOrThrow({ where: { id }, include: { visitor: true } });
  await audit(req, 'STAFF_CHECK_OUT', { passNumber: visit.passNumber });
  res.json({ visit: toStaffVisit(visit) });
});
