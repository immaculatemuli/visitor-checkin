import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { env } from './env';
import { audit } from './lib/audit';

/**
 * Creates the first admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD when there are no
 * staff accounts yet. Lets hosts without a shell (e.g. Render's free plan) get a first sign-in.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await prisma.staff.count()) > 0) return;

  const staff = await prisma.staff.create({
    data: { name: 'System Administrator', email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) },
  });
  await audit(null, 'STAFF_CREATE', { email, role: 'admin', via: 'bootstrap' }, staff.id);
  console.log(`[bootstrap] created admin ${email}`);
}
