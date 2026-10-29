// Edit this list to match the offices at your site. Values are stored on each visit.
export const DEPARTMENTS = [
  'Administration',
  'Human Resources',
  'Finance & Accounts',
  'Procurement',
  'ICT',
  'Legal',
  'Communications',
  'Training',
  'Registry',
  'Other',
] as const;

// Bump this when the consent notice text changes; visitors re-accept on their next first-time scan.
export const CONSENT_VERSION = '2026-10';

export const DEVICE_COOKIE = 'vc_device';
export const STAFF_COOKIE = 'vc_staff';
export const DEVICE_TOKEN_TTL_DAYS = 180;
export const STAFF_SESSION_HOURS = 8;
// Scanning the reception QR unlocks self check-in on that phone for this long.
export const SCAN_COOKIE = 'vc_scan';
export const SCAN_VALID_MINUTES = 30;

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_WINDOW = 3;
export const OTP_WINDOW_MINUTES = 15;

export const EXPORT_MAX_ROWS = 5000;
