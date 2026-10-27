import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../env';
import { HttpError } from '../lib/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in addition to SameSite cookies: browsers won't send a custom header
 * on a cross-site form post, and CORS blocks it from other origins' scripts.
 */
export function requireAjaxHeader(req: Request, _res: Response, next: NextFunction): void {
  if (!SAFE_METHODS.has(req.method) && req.get('x-requested-with') !== 'fetch') {
    throw new HttpError(403, 'Missing request header.');
  }
  next();
}

function limiter(windowMinutes: number, limit: number, message: string) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: message },
  });
}

// Limits are per client IP. Reception guest Wi-Fi may put many visitors behind one IP,
// so the check-in limit is deliberately generous.
export const checkInLimiter = limiter(15, 60, 'Too many check-in attempts. Please wait a few minutes.');
export const otpLimiter = limiter(15, 10, 'Too many code requests. Please wait a few minutes.');
export const loginLimiter = limiter(15, 10, 'Too many sign-in attempts. Please wait 15 minutes.');
