import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { docLast4, hashDocument, maskDocument } from '../../lib/crypto';
import { HttpError } from '../../lib/http';
import { requireRole } from '../../middleware/auth';
import { watchlistDocumentSchema } from '../../schemas';

export const watchlistRouter = Router();

watchlistRouter.get('/', async (_req, res) => {
  const entries = await prisma.watchlistEntry.findMany({
    orderBy: { createdAt: 'desc' },
    include: { addedBy: { select: { name: true } } },
  });
  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      documentType: e.documentType,
      documentMasked: maskDocument(e.documentLast4),
      reason: e.reason,
      addedBy: e.addedBy?.name ?? null,
      createdAt: e.createdAt,
    })),
  });
});

watchlistRouter.post('/', async (req, res) => {
  const input = watchlistDocumentSchema.parse(req.body);
  const documentNumberHash = hashDocument(input.documentType, input.documentNumber);

  const existing = await prisma.watchlistEntry.findUnique({ where: { documentNumberHash } });
  if (existing) throw new HttpError(409, 'This document is already on the watchlist.');

  const entry = await prisma.watchlistEntry.create({
    data: {
      documentType: input.documentType,
      documentNumberHash,
      documentLast4: docLast4(input.documentNumber),
      reason: input.reason,
      addedById: req.staff!.id,
    },
  });

  // Anyone with this document who is already inside gets flagged for security.
  const flagged = await prisma.visit.updateMany({
    where: { status: 'CHECKED_IN', visitor: { documentNumberHash } },
    data: { flagged: true, watchlistHit: true, flagReason: 'Added to watchlist while on premises' },
  });

  await audit(req, 'WATCHLIST_ADD', {
    documentType: input.documentType,
    last4: entry.documentLast4,
    reason: input.reason,
    flaggedInside: flagged.count,
  });
  res.status(201).json({ id: entry.id, flaggedInside: flagged.count });
});

watchlistRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const entry = await prisma.watchlistEntry.findUnique({ where: { id } });
  if (!entry) throw new HttpError(404, 'Watchlist entry not found.');
  await prisma.watchlistEntry.delete({ where: { id } });
  await audit(req, 'WATCHLIST_REMOVE', { documentType: entry.documentType, last4: entry.documentLast4 });
  res.status(204).end();
});
