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
  // Built client (client/dist). When set, the API also serves the web app from the same origin.
  STATIC_DIR: z.string().optional(),
  // Creates this admin on startup if no staff account exists yet (for hosts without a shell).
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12, 'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters').optional(),
  COOKIE_SECURE: bool.optional(),
  // Number of reverse proxies in front of the API (Render = 1, Vercel rewrite + Render = 2).
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  ORG_NAME: z.string().default(''),
  DPO_CONTACT: z.string().default(''),
  TIMEZONE: z.string().default('Africa/Nairobi'),
  END_OF_DAY_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .default('18:00'),
  RETENTION_MONTHS: z.coerce.number().int().min(1).default(12),
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(1).default(24),
  ENABLE_JOBS: bool.default(true),
  SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
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

export const env = {
  ...raw,
  COOKIE_SECURE: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
  CLIENT_ORIGINS: clientOrigin.split(',').map((o) => o.trim()),
};
