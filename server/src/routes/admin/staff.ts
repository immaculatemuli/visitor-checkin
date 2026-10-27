import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { HttpError } from '../../lib/http';

export const staffRouter = Router();

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const publicFields = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true };

staffRouter.get('/', async (_req, res) => {
  const staff = await prisma.staff.findMany({ select: publicFields, orderBy: { name: 'asc' } });
  res.json({ staff });
});

staffRouter.post('/', async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().toLowerCase().pipe(z.email()),
      role: z.enum(['admin', 'security']),
      password,
    })
    .parse(req.body);

  const staff = await prisma.staff.create({
    data: { name: input.name, email: input.email, role: input.role, passwordHash: await bcrypt.hash(input.password, 12) },
    select: publicFields,
  });
  await audit(req, 'STAFF_CREATE', { email: staff.email, role: staff.role });
  res.status(201).json({ staff });
});

staffRouter.patch('/:id', async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = z
    .object({ role: z.enum(['admin', 'security']).optional(), active: z.boolean().optional(), password: password.optional() })
    .parse(req.body);

  if (id === req.staff!.id && (input.active === false || input.role === 'security')) {
    throw new HttpError(400, 'You cannot deactivate or demote your own account.');
  }

  const staff = await prisma.staff.update({
    where: { id },
    data: {
      role: input.role,
      active: input.active,
      passwordHash: input.password ? await bcrypt.hash(input.password, 12) : undefined,
    },
    select: publicFields,
  });
  await audit(req, 'STAFF_UPDATE', {
    email: staff.email,
    role: input.role,
    active: input.active,
    passwordReset: Boolean(input.password),
  });
  res.json({ staff });
});
