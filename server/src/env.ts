import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  DOC_HASH_SECRET: z.string().min(32, 'DOC_HASH_SECRET must be at least 32 characters'),
  // Comma-separated list of allowed browser origins. On Render, defaults to the service's own URL.
  CLIENT_ORIGIN: z.string().min(1).optional(),
  RENDER_EXTERNAL_URL: z.string().optional(),
  // Set by Render on its servers; proxy trust is then worked out automatically (see lib/proxy.ts).
  RENDER: bool.optional(),
  // Built client (client/dist). When set, the API also serves the web app from the same origin.
  STATIC_DIR: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  // Number of reverse proxies in front of the API. Ignored on Render, which is handled automatically.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  ORG_NAME: z.string().default(''),
  DPO_CONTACT: z.string().default(''),
  TIMEZONE: z.string().default('Africa/Nairobi'),
  END_OF_DAY_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .default('18:00'),
  // Attendance report: a first check-in of the day after this time counts as late.
  ATTENDANCE_START_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .default('08:30'),
  RETENTION_MONTHS: z.coerce.number().int().min(1).default(12),
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(1).default(24),
  ENABLE_JOBS: bool.default(true),
  // Self check-in only after scanning the QR code at reception (the poster in the dashboard).
  REQUIRE_RECEPTION_SCAN: bool.default(true),
  // Who must be on the office Wi-Fi to check in (once an office network is added in the dashboard).
  ONSITE_CHECKIN: z.enum(['attachee', 'all', 'off']).default('attachee'),
  SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
});

// Hosting dashboards often save blank or space-padded values; treat blank as unset.
const cleaned = Object.fromEntries(
  Object.entries(process.env)
    .map(([k, v]) => [k, v?.trim()])
    .filter(([, v]) => v !== ''),
);

const parsed = schema.safeParse(cleaned);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

const clientOrigin = raw.CLIENT_ORIGIN ?? raw.RENDER_EXTERNAL_URL;
if (!clientOrigin) {
  throw new Error('Invalid environment configuration:\n  CLIENT_ORIGIN: Required (or run on Render, which sets RENDER_EXTERNAL_URL)');
}

if (raw.SMS_PROVIDER === 'africastalking' && (!raw.AT_USERNAME || !raw.AT_API_KEY)) {
  throw new Error('SMS_PROVIDER=africastalking requires AT_USERNAME and AT_API_KEY');
}

/**
 * An email/password pair from PREFIX_EMAIL and PREFIX_PASSWORD (for hosts without a shell). A bad
 * value is logged and skipped rather than stopping the whole app.
 */
function adminCredentials(prefix: 'BOOTSTRAP_ADMIN' | 'RECOVER_ADMIN'): { email?: string; password?: string } {
  const email = cleaned[`${prefix}_EMAIL`]?.replace(/^["']|["']$/g, '').toLowerCase();
  const password = cleaned[`${prefix}_PASSWORD`];
  if (!email && !password) return {};
  if (!email || !z.email().safeParse(email).success) {
    console.warn(`[env] ${prefix}_EMAIL is missing or not a valid email; ignoring it`);
    return {};
  }
  if (!password || password.length < 12) {
    console.warn(`[env] ${prefix}_PASSWORD must be at least 12 characters; ignoring it`);
    return {};
  }
  return { email, password };
}

// Optional first admin, created on startup if no staff account exists yet.
const bootstrap = adminCredentials('BOOTSTRAP_ADMIN');
// Emergency way back in when every admin is locked out: on startup this admin's password is set
// (the account is created or re-enabled if needed). Remove both settings once signed in.
const recover = adminCredentials('RECOVER_ADMIN');

export const env = {
  ...raw,
  BOOTSTRAP_ADMIN_EMAIL: bootstrap.email,
  BOOTSTRAP_ADMIN_PASSWORD: bootstrap.password,
  RECOVER_ADMIN_EMAIL: recover.email,
  RECOVER_ADMIN_PASSWORD: recover.password,
  COOKIE_SECURE: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
  CLIENT_ORIGINS: clientOrigin.split(',').map((o) => o.trim()),
};
