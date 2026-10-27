import cron from 'node-cron';
import { prisma } from '../db';
import { env } from '../env';
import { audit } from '../lib/audit';
import { lastEndOfDay } from '../lib/time';

/**
 * Flags visits still open after the most recent end-of-day time. Runs hourly (not just once
 * at closing time) so a server that was asleep or restarting still catches up.
 */
export async function flagOverdueVisits(now = new Date()): Promise<number> {
  const cutoff = lastEndOfDay(now, env.TIMEZONE, env.END_OF_DAY_TIME);
  const result = await prisma.visit.updateMany({
    where: {
      status: { in: ['CHECKED_IN', 'PENDING_APPROVAL'] },
      flagged: false,
      createdAt: { lt: cutoff },
    },
    data: { flagged: true, flagReason: 'Not checked out by end of day' },
  });
  return result.count;
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Deletes data older than the configured retention period. */
export async function purgeExpiredData(now = new Date()) {
  const visitCutoff = monthsAgo(now, env.RETENTION_MONTHS);
  const auditCutoff = monthsAgo(now, env.AUDIT_RETENTION_MONTHS);

  const visits = await prisma.visit.deleteMany({
    where: { createdAt: { lt: visitCutoff }, status: { in: ['CHECKED_OUT', 'DENIED'] } },
  });
  const visitors = await prisma.visitor.deleteMany({
    where: { updatedAt: { lt: visitCutoff }, visits: { none: {} } },
  });
  const auditLogs = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
  const otps = await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  const tokens = await prisma.deviceToken.deleteMany({ where: { expiresAt: { lt: now } } });

  const summary = {
    visits: visits.count,
    visitors: visitors.count,
    auditLogs: auditLogs.count,
    otpCodes: otps.count,
    deviceTokens: tokens.count,
  };
  if (visits.count || visitors.count || auditLogs.count) {
    await audit(null, 'RETENTION_PURGE', { ...summary, retentionMonths: env.RETENTION_MONTHS });
  }
  return summary;
}

function run(name: string, fn: () => Promise<unknown>) {
  fn()
    .then((r) => console.log(`[job] ${name}:`, r))
    .catch((err) => console.error(`[job] ${name} failed`, err));
}

export function startJobs(): void {
  const opts = { timezone: env.TIMEZONE };
  cron.schedule('5 * * * *', () => run('flag-overdue', flagOverdueVisits), opts);
  cron.schedule('30 2 * * *', () => run('retention-purge', purgeExpiredData), opts);
  run('flag-overdue', flagOverdueVisits);
}
