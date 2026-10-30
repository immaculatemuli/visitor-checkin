import { z } from 'zod';
import { CONSENT_VERSION, DEPARTMENTS } from './config/constants';
import { env } from './env';
import { normalizeDocNumber } from './lib/crypto';
import { normalizePhone } from './lib/phone';
import { isValidIsoDate, localDate } from './lib/time';

export const isoDate = z.string().refine(isValidIsoDate, 'Use a valid date (YYYY-MM-DD)');

export const phoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0712 345 678 or +44 7700 900123' });
    return z.NEVER;
  }
  return phone;
});

const visitFields = z.object({
  category: z.enum(['visitor', 'attachee']).default('visitor'),
  department: z.enum(DEPARTMENTS, { error: 'Choose a department' }),
  hostName: z.string().trim().max(100).optional(),
  purpose: z.string().trim().max(300).optional(),
});

type VisitFields = z.infer<typeof visitFields>;

// Check-in asks only for the department; host and purpose are optional extras.
export const visitDetailsSchema = visitFields;

const documentFields = z.object({
  documentType: z.enum(['national_id', 'passport']),
  fullName: z
    .string()
    .trim()
    .min(3, 'Enter your full name')
    .max(120)
    .regex(/^[\p{L} .'-]+$/u, 'Name can only contain letters, spaces, apostrophes and hyphens'),
  documentNumber: z.string().trim().max(20).transform(normalizeDocNumber),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Nationality must be a 3-letter code, e.g. KEN')
    .optional(),
  dob: isoDate.optional(),
  documentExpiry: isoDate.optional(),
  phone: phoneSchema.optional(),
});

type DocumentFields = z.infer<typeof documentFields>;

function refineDocument(data: DocumentFields, ctx: z.RefinementCtx): void {
  const today = localDate(new Date(), env.TIMEZONE);

  if (data.documentType === 'national_id' && !/^\d{6,10}$/.test(data.documentNumber)) {
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'National ID number should be 6–10 digits' });
  }
  if (data.documentType === 'passport') {
    if (!/^[A-Z0-9]{5,12}$/.test(data.documentNumber)) {
      ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Enter a valid passport number' });
    }
    if (!data.nationality) {
      ctx.addIssue({ code: 'custom', path: ['nationality'], message: 'Nationality is required for passports' });
    }
    if (!data.documentExpiry) {
      ctx.addIssue({ code: 'custom', path: ['documentExpiry'], message: 'Passport expiry date is required' });
    } else if (data.documentExpiry < today) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentExpiry'],
        message: 'This passport has expired. Please see the reception desk.',
      });
    }
  }
  if (data.dob && data.dob >= today) {
    ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Date of birth must be in the past' });
  }
}

function refineCheckIn(data: DocumentFields & VisitFields, ctx: z.RefinementCtx): void {
  refineDocument(data, ctx);
}

export const newCheckInSchema = documentFields
  .extend(visitFields.shape)
  .extend({
    consent: z.literal(true, { error: 'You must accept the data protection notice' }),
    consentVersion: z.literal(CONSENT_VERSION, {
      error: 'The data protection notice has changed. Please reload the page.',
    }),
  })
  .superRefine(refineCheckIn);

export const manualCheckInSchema = documentFields
  .extend(visitFields.shape)
  .extend({
    consent: z.literal(true, { error: 'Confirm the visitor has been informed and consents' }),
  })
  .superRefine(refineCheckIn);

export const watchlistDocumentSchema = z.object({
  documentType: z.enum(['national_id', 'passport']),
  documentNumber: z.string().trim().min(5).max(20).transform(normalizeDocNumber),
  reason: z.string().trim().min(3).max(300),
});

export const staffPasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
