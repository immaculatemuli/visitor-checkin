import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { recoverAdmin } from '../src/bootstrap';
import { prisma } from '../src/db';
import { env } from '../src/env';
import { CONSENT_VERSION } from '../src/config/constants';
import { workingDays } from '../src/lib/attendance';

const app = createApp();
const AJAX = { 'X-Requested-With': 'fetch' };

async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE visits, visitors, watchlist, audit_logs, device_tokens, otp_codes, office_networks, app_settings, staff RESTART IDENTITY CASCADE',
  );
}

async function staffAgent(role: 'admin' | 'security', password = 'Password123') {
  const email = `${role}@test.local`;
  await prisma.staff.create({ data: { name: `Test ${role}`, email, role, passwordHash: await bcrypt.hash(password, 4) } });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set(AJAX).send({ email, password }).expect(200);
  return agent;
}

async function person(name: string, last4: string) {
  return prisma.visitor.create({
    data: {
      fullName: name,
      documentType: 'national_id',
      documentNumberHash: `hash-${last4}`,
      documentLast4: last4,
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  });
}

let pass = 0;
// Times are Nairobi wall-clock (UTC+3).
async function visit(visitorId: string, category: 'attachee' | 'visitor', inAt: string, outAt: string | null, missed = false) {
  const checkInAt = new Date(`${inAt}:00+03:00`);
  return prisma.visit.create({
    data: {
      visitorId,
      category,
      department: 'ICT',
      passNumber: `VIS-TEST-${++pass}`,
      method: 'SELF',
      status: outAt ? 'CHECKED_OUT' : 'CHECKED_IN',
      checkInAt,
      createdAt: checkInAt,
      checkOutAt: outAt ? new Date(`${outAt}:00+03:00`) : null,
      flagged: missed,
      flagReason: missed ? 'Not checked out by end of day' : null,
    },
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('attendance report', () => {
  it('counts working days, leaving out weekends and days still to come', () => {
    expect(workingDays('2026-10-05', '2026-10-11', '2026-10-30')).toBe(5);
    expect(workingDays('2026-10-05', '2026-10-30', '2026-10-07')).toBe(3);
  });

  it('summarises each attachee: days, hours, late arrivals and missed check-outs', async () => {
    const security = await staffAgent('security');
    const brian = await person('Brian Kipkorir Otieno', '6789');
    const grace = await person('Grace Akinyi Wanjiku', '5678');
    // Week of Mon 5 to Fri 9 October 2026.
    await visit(brian.id, 'attachee', '2026-10-05T08:10', '2026-10-05T17:00'); // 8h50
    await visit(brian.id, 'attachee', '2026-10-06T09:05', '2026-10-06T17:00'); // late, 7h55
    await visit(brian.id, 'attachee', '2026-10-07T08:20', '2026-10-07T18:00', true); // forgot to check out
    await visit(grace.id, 'visitor', '2026-10-05T10:00', '2026-10-05T11:00'); // a visitor, not in the attachee report

    const res = await security.get('/api/admin/reports/attendance?from=2026-10-05&to=2026-10-09').expect(200);
    expect(res.body).toMatchObject({ from: '2026-10-05', to: '2026-10-09', workingDays: 5, startTime: '08:30' });
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      name: 'Brian Kipkorir Otieno',
      documentMasked: '****6789',
      daysPresent: 3,
      attendancePct: 60,
      totalMinutes: 530 + 475,
      averageMinutesPerDay: Math.round((530 + 475) / 2),
      lateArrivals: 1,
      missedCheckouts: 1,
      firstDay: '2026-10-05',
      lastDay: '2026-10-07',
      insideNow: false,
    });
  });

  it('exports the report to CSV and records the export', async () => {
    const security = await staffAgent('security');
    const brian = await person('Brian Kipkorir Otieno', '6789');
    await visit(brian.id, 'attachee', '2026-10-05T08:10', '2026-10-05T17:00');
    const csv = await security.get('/api/admin/reports/attendance/export/csv?from=2026-10-05&to=2026-10-09').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Days present');
    expect(csv.text).toContain('Brian Kipkorir Otieno');
    expect(csv.text).toContain('8h 50m');
    expect(await prisma.auditLog.count({ where: { action: 'EXPORT_ATTENDANCE' } })).toBe(1);
  });

  it('rejects a backwards date range', async () => {
    const security = await staffAgent('security');
    await security.get('/api/admin/reports/attendance?from=2026-10-09&to=2026-10-05').expect(400);
  });
});

describe('passwords', () => {
  it('lets staff change their own password after confirming the current one', async () => {
    const security = await staffAgent('security');
    const wrong = await security.post('/api/auth/password').set(AJAX).send({ currentPassword: 'nope', newPassword: 'NewPassword456' }).expect(400);
    expect(wrong.body.issues).toEqual([{ path: 'currentPassword', message: 'Not correct' }]);
    await security.post('/api/auth/password').set(AJAX).send({ currentPassword: 'Password123', newPassword: 'short' }).expect(400);
    await security.post('/api/auth/password').set(AJAX).send({ currentPassword: 'Password123', newPassword: 'NewPassword456' }).expect(204);

    await request(app).post('/api/auth/login').set(AJAX).send({ email: 'security@test.local', password: 'Password123' }).expect(401);
    await request(app).post('/api/auth/login').set(AJAX).send({ email: 'security@test.local', password: 'NewPassword456' }).expect(200);
  });

  it('recovers a locked-out admin from the RECOVER_ADMIN settings', async () => {
    await prisma.staff.create({
      data: { name: 'Locked', email: 'boss@test.local', role: 'security', active: false, passwordHash: await bcrypt.hash('Forgotten999', 4) },
    });
    env.RECOVER_ADMIN_EMAIL = 'boss@test.local';
    env.RECOVER_ADMIN_PASSWORD = 'Recovered-2026';
    try {
      await recoverAdmin();
    } finally {
      env.RECOVER_ADMIN_EMAIL = undefined;
      env.RECOVER_ADMIN_PASSWORD = undefined;
    }
    const res = await request(app).post('/api/auth/login').set(AJAX).send({ email: 'boss@test.local', password: 'Recovered-2026' }).expect(200);
    expect(res.body.staff.role).toBe('admin');
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_RECOVERY' } })).toBe(1);
  });
});
