import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { requireRole, requireStaff } from '../../middleware/auth';
import { networksRouter } from './networks';
import { staffRouter } from './staff';
import { visitsRouter } from './visits';
import { watchlistRouter } from './watchlist';

export const adminRouter = Router();

// Every admin route requires a signed-in, active staff member; some also require the admin role.
adminRouter.use(requireStaff, requireRole('admin', 'security'));

adminRouter.use('/visits', visitsRouter);
adminRouter.use('/watchlist', watchlistRouter);
adminRouter.use('/networks', networksRouter);
adminRouter.use('/staff', requireRole('admin'), staffRouter);

adminRouter.get('/audit', requireRole('admin'), async (req, res) => {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      action: z.string().trim().max(50).optional(),
    })
    .parse(req.query);
  const where = q.action ? { action: q.action } : {};
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { staff: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, logs });
});
