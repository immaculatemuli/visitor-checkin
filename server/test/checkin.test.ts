import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { CONSENT_VERSION } from '../src/config/constants';
import { hashDocument } from '../src/lib/crypto';
import { flagOverdueVisits } from '../src/jobs';
import { env } from '../src/env';
import { networkOf, normalizeIp } from '../src/lib/network';

const app = createApp();
// Most tests check in directly; the reception QR scan has its own tests below.
env.REQUIRE_RECEPTION_SCAN = false;
const AJAX = { 'X-Requested-With': 'fetch' };

const nationalId = {
  documentType: 'national_id',
  fullName: 'Grace Akinyi Wanjiku',
  documentNumber: '12345678',
  dob: '1990-01-15',
  phone: '0722 000 111',
  hostName: 'Mr. Otieno',
  department: 'ICT',
  purpose: 'Network installation meeting',
  consent: true,
  consentVersion: CONSENT_VERSION,
};

const passport = {
  ...nationalId,
  documentType: 'passport',
  fullName: 'Sarah Nakato',
  documentNumber: 'B1234567',
  nationality: 'UGA',
  documentExpiry: '2035-03-09',
  phone: '+256 772 123456',
};

async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE visits, visitors, watchlist, audit_logs, device_tokens, otp_codes, office_networks, app_settings, staff RESTART IDENTITY CASCADE',
  );
}

async function staffAgent(role: 'admin' | 'security') {
  const email = `${role}@test.local`;
  await prisma.staff.create({
    data: { name: `Test ${role}`, email, role, passwordHash: await bcrypt.hash('Password123', 4) },
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set(AJAX).send({ email, password: 'Password123' }).expect(200);
  return agent;
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('first-time check-in', () => {
  it('checks in with a national ID, issues a pass and remembers the device', async () => {
    const res = await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);

    expect(res.body.visit).toMatchObject({
      status: 'CHECKED_IN',
      visitorName: 'Grace Akinyi Wanjiku',
      documentMasked: '****5678',
      hostName: 'Mr. Otieno',
      department: 'ICT',
    });
    expect(res.body.visit.passNumber).toMatch(/^VIS-\d{6}-[A-Z2-9]{4}$/);
    expect(res.body.visit.checkInAt).toBeTruthy();
    expect(String(res.headers['set-cookie'])).toMatch(/vc_device=.*HttpOnly/i);
  });

  it('stores the document number hashed and the phone normalised, never the raw number', async () => {
    await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const visitor = await prisma.visitor.findFirstOrThrow();

    expect(visitor.documentNumberHash).toBe(hashDocument('national_id', '12345678'));
    expect(visitor.documentLast4).toBe('5678');
    expect(visitor.phone).toBe('+254722000111');
    expect(JSON.stringify(visitor)).not.toContain('12345678');
  });

  it('accepts a valid passport', async () => {
    const res = await request(app).post('/api/public/checkin').set(AJAX).send(passport).expect(201);
    expect(res.body.visit.documentType).toBe('passport');
    expect(res.body.visit.documentMasked).toBe('****4567');
  });

  it('rejects an expired passport', async () => {
    const res = await request(app)
      .post('/api/public/checkin')
      .set(AJAX)
      .send({ ...passport, documentExpiry: '2024-03-09' })
      .expect(400);
    expect(res.body.error).toMatch(/expired/i);
    expect(await prisma.visit.count()).toBe(0);
  });

  it('requires data-protection consent', async () => {
    const res = await request(app)
      .post('/api/public/checkin')
      .set(AJAX)
      .send({ ...nationalId, consent: false })
      .expect(400);
    expect(res.body.error).toMatch(/data protection/i);
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/public/checkin')
      .set(AJAX)
      .send({ ...nationalId, phone: '123', department: 'Nowhere' })
      .expect(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['phone', 'department']));
  });

  it('refuses requests without the CSRF header', async () => {
    await request(app).post('/api/public/checkin').send(nationalId).expect(403);
  });

  it('does not open a second visit while the visitor is still inside', async () => {
    const first = await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const second = await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(409);
    expect(second.body.passNumber).toBe(first.body.visit.passNumber);
    expect(await prisma.visit.count()).toBe(1);
  });
});

describe('check-out and returning visitors', () => {
  it('checks out using the device cookie', async () => {
    const visitor = request.agent(app);
    await visitor.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);

    const res = await visitor.post('/api/public/checkout').set(AJAX).expect(200);
    expect(res.body.visit.status).toBe('CHECKED_OUT');
    expect(res.body.visit.checkOutAt).toBeTruthy();

    await visitor.post('/api/public/checkout').set(AJAX).expect(409);
  });

  it('lets a recognised device check in again without rescanning', async () => {
    const visitor = request.agent(app);
    await visitor.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    await visitor.post('/api/public/checkout').set(AJAX).expect(200);

    const me = await visitor.get('/api/public/me').expect(200);
    expect(me.body.visitor.firstName).toBe('Grace');
    expect(me.body.openVisit).toBeNull();
    expect(me.body.lastVisitDetails.department).toBe('ICT');

    const res = await visitor
      .post('/api/public/checkin/returning')
      .set(AJAX)
      .send({ hostName: 'Ms. Njeri', department: 'Registry', purpose: 'Collect documents' })
      .expect(201);
    expect(res.body.visit).toMatchObject({ status: 'CHECKED_IN', department: 'Registry' });

    const visits = await prisma.visit.findMany({ orderBy: { createdAt: 'asc' } });
    expect(visits.map((v) => v.method)).toEqual(['SELF', 'RETURNING']);
  });

  it('rejects returning check-in and check-out from an unknown device', async () => {
    const details = { hostName: 'Ms. Njeri', department: 'Registry', purpose: 'Collect documents' };
    await request(app).post('/api/public/checkin/returning').set(AJAX).send(details).expect(401);
    await request(app).post('/api/public/checkout').set(AJAX).expect(401);
  });

  it('recognises a returning visitor on a new phone via SMS code', async () => {
    await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    await prisma.visit.updateMany({ data: { status: 'CHECKED_OUT', checkOutAt: new Date() } });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const newPhone = request.agent(app);
    await newPhone.post('/api/public/otp/request').set(AJAX).send({ phone: '+254722000111' }).expect(200);
    const code = String(log.mock.calls.flat().join(' ')).match(/code is (\d{6})/)?.[1];
    log.mockRestore();
    expect(code).toBeDefined();

    await newPhone.post('/api/public/otp/verify').set(AJAX).send({ phone: '0722000111', code: '000000' }).expect(400);
    const ok = await newPhone.post('/api/public/otp/verify').set(AJAX).send({ phone: '0722000111', code }).expect(200);
    expect(ok.body.visitor.firstName).toBe('Grace');

    await newPhone
      .post('/api/public/checkin/returning')
      .set(AJAX)
      .send({ hostName: 'Mr. Otieno', department: 'ICT', purpose: 'Follow-up meeting' })
      .expect(201);
  });

  it('gives the same OTP response for unknown numbers', async () => {
    const res = await request(app).post('/api/public/otp/request').set(AJAX).send({ phone: '0799000000' }).expect(200);
    expect(res.body.message).toMatch(/if this number is registered/i);
    expect(await prisma.otpCode.count()).toBe(0);
  });
});

describe('attachees', () => {
  const attachee = { ...nationalId, category: 'attachee', hostName: undefined, purpose: undefined };

  it('checks in an attachee with only a department', async () => {
    const res = await request(app).post('/api/public/checkin').set(AJAX).send(attachee).expect(201);
    expect(res.body.visit).toMatchObject({ category: 'attachee', department: 'ICT', hostName: null, purpose: null });
  });

  it('ignores host and purpose sent for an attachee', async () => {
    const res = await request(app)
      .post('/api/public/checkin')
      .set(AJAX)
      .send({ ...attachee, hostName: 'Someone', purpose: 'Something' })
      .expect(201);
    expect(res.body.visit).toMatchObject({ hostName: null, purpose: null });
  });

  it('checks a visitor in with just the scanned ID and a department', async () => {
    const res = await request(app)
      .post('/api/public/checkin')
      .set(AJAX)
      .send({ ...nationalId, phone: undefined, hostName: undefined, purpose: undefined })
      .expect(201);
    expect(res.body.visit).toMatchObject({ category: 'visitor', department: 'ICT', hostName: null, purpose: null });
    const visitor = await prisma.visitor.findFirstOrThrow();
    expect(visitor.phone).toBeNull();
  });

  it('keeps the phone on file when the visitor rescans without one', async () => {
    const first = request.agent(app);
    await first.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    await first.post('/api/public/checkout').set(AJAX).expect(200);
    await request(app).post('/api/public/checkin').set(AJAX).send({ ...nationalId, phone: undefined }).expect(201);
    const visitor = await prisma.visitor.findFirstOrThrow();
    expect(visitor.phone).toBe('+254722000111');
  });

  it('remembers the category so the next day is one tap', async () => {
    const phone = request.agent(app);
    await phone.post('/api/public/checkin').set(AJAX).send(attachee).expect(201);
    await phone.post('/api/public/checkout').set(AJAX).expect(200);

    const me = await phone.get('/api/public/me').expect(200);
    expect(me.body.lastVisitDetails).toMatchObject({ category: 'attachee', department: 'ICT' });

    await phone
      .post('/api/public/checkin/returning')
      .set(AJAX)
      .send({ category: 'attachee', department: 'ICT' })
      .expect(201);
  });

  it('counts attachees separately on the dashboard', async () => {
    const security = await staffAgent('security');
    await request(app).post('/api/public/checkin').set(AJAX).send(attachee).expect(201);
    await request(app).post('/api/public/checkin').set(AJAX).send(passport).expect(201);
    const stats = await security.get('/api/admin/visits/stats').expect(200);
    expect(stats.body).toMatchObject({ visitorsInside: 1, attacheesInside: 1 });
  });
});

describe('watchlist', () => {
  it('holds a watchlisted visitor for security approval', async () => {
    const security = await staffAgent('security');
    await security
      .post('/api/admin/watchlist')
      .set(AJAX)
      .send({ documentType: 'national_id', documentNumber: '12345678', reason: 'Trespass notice' })
      .expect(201);

    const visitor = request.agent(app);
    const res = await visitor.post('/api/public/checkin').set(AJAX).send(nationalId).expect(202);
    expect(res.body.visit.status).toBe('PENDING_APPROVAL');
    expect(res.body.visit.checkInAt).toBeNull();
    await visitor.post('/api/public/checkout').set(AJAX).expect(409);

    const live = await security.get('/api/admin/visits/live').expect(200);
    expect(live.body.pending).toHaveLength(1);
    expect(live.body.pending[0].watchlistHit).toBe(true);

    const approved = await security.post(`/api/admin/visits/${live.body.pending[0].id}/approve`).set(AJAX).expect(200);
    expect(approved.body.visit.status).toBe('CHECKED_IN');

    const pass = await visitor.get('/api/public/pass').expect(200);
    expect(pass.body.visit.status).toBe('CHECKED_IN');

    const log = await prisma.auditLog.findMany({ select: { action: true } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['WATCHLIST_ADD', 'APPROVE_WATCHLIST_VISIT']));
  });
});

describe('admin access control', () => {
  it('requires a staff session', async () => {
    await request(app).get('/api/admin/visits/live').expect(401);
    await request(app).get('/api/admin/visits').expect(401);
  });

  it('restricts admin-only actions to admins', async () => {
    const security = await staffAgent('security');
    const created = await security
      .post('/api/admin/watchlist')
      .set(AJAX)
      .send({ documentType: 'passport', documentNumber: 'X9876543', reason: 'Test' })
      .expect(201);
    await security.delete(`/api/admin/watchlist/${created.body.id}`).set(AJAX).expect(403);
    await security.get('/api/admin/staff').expect(403);
    await security.get('/api/admin/audit').expect(403);

    const admin = await staffAgent('admin');
    await admin.delete(`/api/admin/watchlist/${created.body.id}`).set(AJAX).expect(204);
  });

  it('lets staff check a visitor out and finds visits by document number', async () => {
    const security = await staffAgent('security');
    await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);

    const found = await security.get('/api/admin/visits').query({ document: '12345678' }).expect(200);
    expect(found.body.total).toBe(1);
    const byLast4 = await security.get('/api/admin/visits').query({ document: '5678' }).expect(200);
    expect(byLast4.body.total).toBe(1);

    const out = await security.post(`/api/admin/visits/${found.body.visits[0].id}/checkout`).set(AJAX).expect(200);
    expect(out.body.visit.status).toBe('CHECKED_OUT');
  });

  it('exports CSV with masked document numbers', async () => {
    const security = await staffAgent('security');
    await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const res = await security.get('/api/admin/visits/export/csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('****5678');
    expect(res.text).not.toContain('12345678');
  });
});

describe('end of day', () => {
  it("closes yesterday's forgotten visit so today starts with check-in", async () => {
    const phone = request.agent(app);
    await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    await prisma.visit.updateMany({ data: { createdAt: yesterday, checkInAt: yesterday } });

    const me = await phone.get('/api/public/me').expect(200);
    expect(me.body.openVisit).toBeNull();
    const old = await prisma.visit.findFirstOrThrow();
    expect(old).toMatchObject({ status: 'CHECKED_OUT', flagged: true });
    expect(old.checkOutAt!.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());

    await phone.post('/api/public/checkin/returning').set(AJAX).send({ department: 'ICT' }).expect(201);
  });

  it("closes yesterday's visit when checking in again without loading the page first", async () => {
    const phone = request.agent(app);
    await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    await prisma.visit.updateMany({ data: { createdAt: yesterday, checkInAt: yesterday } });

    await phone.post('/api/public/checkin/returning').set(AJAX).send({ department: 'ICT' }).expect(201);
    expect(await prisma.visit.count({ where: { status: 'CHECKED_IN' } })).toBe(1);
  });

  it('flags visits still open after closing time', async () => {
    await request(app).post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
    const tomorrow = new Date(Date.now() + 36 * 3600_000);

    expect(await flagOverdueVisits(tomorrow)).toBe(1);
    const visit = await prisma.visit.findFirstOrThrow();
    expect(visit).toMatchObject({ flagged: true, status: 'CHECKED_IN' });
    expect(await flagOverdueVisits(tomorrow)).toBe(0);
  });
});

describe('office Wi-Fi', () => {
  const OFFICE = { 'X-Forwarded-For': '41.90.10.20' };
  const HOME = { 'X-Forwarded-For': '102.68.5.6' };
  const attachee = { ...nationalId, category: 'attachee', hostName: undefined, purpose: undefined };

  async function addOfficeNetwork() {
    const admin = await staffAgent('admin');
    const res = await admin.post('/api/admin/networks').set(AJAX).set(OFFICE).send({ label: 'HQ Wi-Fi' }).expect(201);
    expect(res.body.network).toBe('41.90.10.20');
    return admin;
  }

  it('works out the network of IPv4 and IPv6 addresses', () => {
    expect(normalizeIp('::ffff:41.90.10.20')).toBe('41.90.10.20');
    expect(networkOf('41.90.10.20')).toBe('41.90.10.20');
    expect(networkOf('2c0f:fe38:2::abcd:1')).toBe('2c0f:fe38:2:0::/64');
    expect(networkOf('2c0f:fe38:0002:0000:1111:2222:3333:4444')).toBe('2c0f:fe38:2:0::/64');
  });

  it('restricts nothing until an office network is added', async () => {
    await request(app).post('/api/public/checkin').set(AJAX).set(HOME).send(attachee).expect(201);
  });

  it('refuses an attachee checking in from outside the office, and records the attempt', async () => {
    await addOfficeNetwork();
    const res = await request(app).post('/api/public/checkin').set(AJAX).set(HOME).send(attachee).expect(403);
    expect(res.body).toMatchObject({ code: 'OFF_SITE' });
    expect(await prisma.visit.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'OFFSITE_CHECKIN_BLOCKED' } });
    expect(log.details).toMatchObject({ name: 'Grace Akinyi Wanjiku', category: 'attachee', network: '102.68.5.6' });

    await request(app).post('/api/public/checkin').set(AJAX).set(OFFICE).send(attachee).expect(201);
  });

  it('refuses a returning attachee off site but lets them check out from anywhere', async () => {
    const phone = request.agent(app);
    await phone.post('/api/public/checkin').set(AJAX).set(HOME).send(attachee).expect(201);
    await addOfficeNetwork();
    await phone.post('/api/public/checkout').set(AJAX).set(HOME).expect(200);
    await phone.post('/api/public/checkin/returning').set(AJAX).set(HOME).send({ category: 'attachee', department: 'ICT' }).expect(403);
    await phone.post('/api/public/checkin/returning').set(AJAX).set(OFFICE).send({ category: 'attachee', department: 'ICT' }).expect(201);
  });

  it('tells the check-in screen up front whether the phone is on the office Wi-Fi', async () => {
    const before = await request(app).get('/api/public/onsite?category=attachee').set(HOME).expect(200);
    expect(before.body).toMatchObject({ required: false, onSite: true });
    await addOfficeNetwork();
    const home = await request(app).get('/api/public/onsite?category=attachee').set(HOME).expect(200);
    expect(home.body).toMatchObject({ required: true, onSite: false, network: '102.68.5.6' });
    const office = await request(app).get('/api/public/onsite?category=attachee').set(OFFICE).expect(200);
    expect(office.body).toMatchObject({ required: true, onSite: true });
    const visitor = await request(app).get('/api/public/onsite?category=visitor').set(HOME).expect(200);
    expect(visitor.body.required).toBe(false);
  });

  it('still lets visitors check in on mobile data by default', async () => {
    await addOfficeNetwork();
    await request(app).post('/api/public/checkin').set(AJAX).set(HOME).send(nationalId).expect(201);
  });

  it('shows staff whether they are on a recognised network, and only admins can add one', async () => {
    const admin = await addOfficeNetwork();
    const here = await admin.get('/api/admin/networks').set(OFFICE).expect(200);
    expect(here.body).toMatchObject({ policy: 'attachee', current: { network: '41.90.10.20', recognised: true } });
    const away = await admin.get('/api/admin/networks').set(HOME).expect(200);
    expect(away.body.current.recognised).toBe(false);
    await admin.post('/api/admin/networks').set(AJAX).set(OFFICE).send({ label: 'Again' }).expect(409);

    const security = await staffAgent('security');
    await security.post('/api/admin/networks').set(AJAX).set(HOME).send({ label: 'Home' }).expect(403);
  });
});

describe('reception QR scan', () => {
  beforeEach(() => {
    env.REQUIRE_RECEPTION_SCAN = true;
  });
  afterEach(() => {
    env.REQUIRE_RECEPTION_SCAN = false;
  });

  async function receptionCode() {
    const security = await staffAgent('security');
    const res = await security.get('/api/admin/reception').expect(200);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    return res.body.code as string;
  }

  it('refuses check-in on a phone that has not scanned the reception QR', async () => {
    const phone = request.agent(app);
    const me = await phone.get('/api/public/me').expect(200);
    expect(me.body.scan).toEqual({ required: true, done: false });
    const res = await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(403);
    expect(res.body).toMatchObject({ code: 'SCAN_REQUIRED' });
    expect(await prisma.visit.count()).toBe(0);
  });

  it('lets a phone check in after scanning, and rejects a wrong code', async () => {
    const code = await receptionCode();
    const phone = request.agent(app);
    const bad = await phone.post('/api/public/scan').set(AJAX).send({ code: 'not-the-code' }).expect(400);
    expect(bad.body).toMatchObject({ code: 'BAD_SCAN' });
    await phone.post('/api/public/scan').set(AJAX).send({ code }).expect(204);
    expect((await phone.get('/api/public/me').expect(200)).body.scan.done).toBe(true);
    await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);
  });

  it('needs a fresh scan for every check-in and check-out, including returning visitors', async () => {
    const code = await receptionCode();
    const phone = request.agent(app);
    const scan = () => phone.post('/api/public/scan').set(AJAX).send({ code }).expect(204);
    await scan();
    await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(201);

    // The arrival scan is used up: leaving needs its own scan at the desk.
    const out = await phone.post('/api/public/checkout').set(AJAX).expect(403);
    expect(out.body).toMatchObject({ code: 'SCAN_REQUIRED', error: 'Please scan the QR code at the reception desk to check out.' });
    expect((await phone.get('/api/public/me').expect(200)).body.scan.done).toBe(false);
    await scan();
    await phone.post('/api/public/checkout').set(AJAX).expect(200);

    // Next visit: the returning visitor scans again.
    await phone.post('/api/public/checkin/returning').set(AJAX).send({ department: 'ICT' }).expect(403);
    await scan();
    await phone.post('/api/public/checkin/returning').set(AJAX).send({ department: 'ICT' }).expect(201);
  });

  it('expires a scan after 30 minutes', async () => {
    const code = await receptionCode();
    const phone = request.agent(app);
    await phone.post('/api/public/scan').set(AJAX).send({ code }).expect(204);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000 });
    try {
      await phone.post('/api/public/checkin').set(AJAX).send(nationalId).expect(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets only admins change the code, and the old code stops working', async () => {
    const old = await receptionCode();
    const admin = await staffAgent('admin');
    const changed = await admin.post('/api/admin/reception/change').set(AJAX).expect(200);
    expect(changed.body.code).not.toBe(old);
    await request(app).post('/api/public/scan').set(AJAX).send({ code: old }).expect(400);
    await request(app).post('/api/public/scan').set(AJAX).send({ code: changed.body.code }).expect(204);

    // receptionCode() signed in as security; security can view the code but not change it.
    const guard = request.agent(app);
    await guard.post('/api/auth/login').set(AJAX).send({ email: 'security@test.local', password: 'Password123' }).expect(200);
    await guard.post('/api/admin/reception/change').set(AJAX).expect(403);
  });
});

