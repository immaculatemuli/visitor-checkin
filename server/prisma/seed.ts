import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { CONSENT_VERSION } from '../src/config/constants';
import { docLast4, hashDocument } from '../src/lib/crypto';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@checkin.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe2026!';
const SECURITY_EMAIL = 'security@checkin.local';
const SECURITY_PASSWORD = 'Security2026!';

async function main() {
  const admin = await prisma.staff.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      name: 'System Administrator',
      email: ADMIN_EMAIL,
      role: 'admin',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    },
  });
  await prisma.staff.upsert({
    where: { email: SECURITY_EMAIL },
    update: {},
    create: {
      name: 'Gate Security',
      email: SECURITY_EMAIL,
      role: 'security',
      passwordHash: await bcrypt.hash(SECURITY_PASSWORD, 12),
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    const demoVisitors = [
      { fullName: 'Grace Akinyi Wanjiku', documentType: 'national_id' as const, number: '12345678', phone: '+254712345678', nationality: 'KEN' },
      { fullName: 'John Mwangi Kamau', documentType: 'passport' as const, number: 'AK1234567', phone: '+254722000111', nationality: 'KEN' },
    ];
    for (const [i, v] of demoVisitors.entries()) {
      const hash = hashDocument(v.documentType, v.number);
      const visitor = await prisma.visitor.upsert({
        where: { documentNumberHash: hash },
        update: {},
        create: {
          fullName: v.fullName,
          documentType: v.documentType,
          documentNumberHash: hash,
          documentLast4: docLast4(v.number),
          nationality: v.nationality,
          phone: v.phone,
          dob: new Date('1990-01-15T00:00:00Z'),
          documentExpiry: v.documentType === 'passport' ? new Date('2031-06-22T00:00:00Z') : null,
          consentAt: new Date(),
          consentVersion: CONSENT_VERSION,
        },
      });
      const passNumber = `VIS-DEMO-000${i + 1}`;
      await prisma.visit.upsert({
        where: { passNumber },
        update: {},
        create: {
          visitorId: visitor.id,
          hostName: i === 0 ? 'Mr. Otieno' : 'Ms. Njeri',
          department: i === 0 ? 'Human Resources' : 'ICT',
          purpose: i === 0 ? 'Job interview' : 'Vendor meeting',
          passNumber,
          status: 'CHECKED_OUT',
          method: 'SELF',
          checkInAt: new Date(Date.now() - 26 * 3600_000),
          checkOutAt: new Date(Date.now() - 25 * 3600_000),
        },
      });
    }

    // Demo watchlist entry: check in with national ID 99999999 to see the approval flow.
    const blocked = hashDocument('national_id', '99999999');
    await prisma.watchlistEntry.upsert({
      where: { documentNumberHash: blocked },
      update: {},
      create: {
        documentType: 'national_id',
        documentNumberHash: blocked,
        documentLast4: '9999',
        reason: 'Demo entry: requires security approval',
        addedById: admin.id,
      },
    });
  }

  console.log(`Seeded. Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  Security: ${SECURITY_EMAIL} / ${SECURITY_PASSWORD}`);
  console.log('Change these passwords after first sign-in.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
