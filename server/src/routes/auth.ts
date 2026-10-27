import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { clearStaffSession, requireStaff, setStaffSession } from '../middleware/auth';
import { loginLimiter } from '../middleware/security';

export const authRouter = Router();

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = z
    .object({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1).max(200) })
    .parse(req.body);

  const staff = await prisma.staff.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, staff?.passwordHash ?? DUMMY_HASH);
  if (!staff || !ok || !staff.active) {
    await audit(req, 'LOGIN_FAILED', { email }, staff?.id ?? null);
    throw new HttpError(401, 'Incorrect email or password.');
  }

  await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
  setStaffSession(res, staff);
  await audit(req, 'LOGIN', undefined, staff.id);
  res.json({ staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role } });
});

authRouter.post('/logout', async (req, res) => {
  clearStaffSession(res);
  res.status(204).end();
});

authRouter.get('/me', requireStaff, (req, res) => {
  res.json({ staff: req.staff });
});
