import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { env } from './env';
import { audit } from './lib/audit';

/**
 * Creates the first admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD when there are no
 * staff accounts yet. Lets hosts without a shell (e.g. Render's free plan) get a first sign-in.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await prisma.staff.count()) > 0) return;

  const staff = await prisma.staff.create({
    data: { name: 'System Administrator', email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) },
  });
  await audit(null, 'STAFF_CREATE', { email, role: 'admin', via: 'bootstrap' }, staff.id);
  console.log(`[bootstrap] created admin ${email}`);
}

/**
 * Emergency recovery when every admin is locked out: RECOVER_ADMIN_EMAIL / RECOVER_ADMIN_PASSWORD
 * set that account's password on startup, making it an active admin (creating it if needed).
 * Runs on every start while set, so the settings should be removed once the admin has signed in.
 */
export async function recoverAdmin(): Promise<void> {
  const email = env.RECOVER_ADMIN_EMAIL;
  const password = env.RECOVER_ADMIN_PASSWORD;
  if (!email || !password) return;

  const passwordHash = await bcrypt.hash(password, 12);
  const staff = await prisma.staff.upsert({
    where: { email },
    update: { passwordHash, role: 'admin', active: true },
    create: { name: 'System Administrator', email, role: 'admin', passwordHash },
  });
  await audit(null, 'ADMIN_RECOVERY', { email }, staff.id);
  console.warn(`[recovery] password reset for admin ${email}. Remove RECOVER_ADMIN_EMAIL and RECOVER_ADMIN_PASSWORD now.`);
}
