const TZ = 'Africa/Nairobi';

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-KE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Awaiting security',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  DENIED: 'Entry denied',
};

export const DOC_LABEL: Record<string, string> = {
  national_id: 'National ID',
  passport: 'Passport',
};

export function publicUrl(path: string): string {
  const base = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;
  return base.replace(/\/$/, '') + path;
}
