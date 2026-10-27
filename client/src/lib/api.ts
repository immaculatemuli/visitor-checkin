const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** Field-level messages from server-side Zod validation, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const issues = (this.body.issues as { path: string; message: string }[] | undefined) ?? [];
    return Object.fromEntries(issues.map((i) => [i.path, i.message]));
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: {
        'X-Requested-With': 'fetch',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.', data);
  return data as T;
}

export function apiUrl(path: string): string {
  return BASE + path;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export type DocumentType = 'national_id' | 'passport';
export type VisitStatus = 'PENDING_APPROVAL' | 'CHECKED_IN' | 'CHECKED_OUT' | 'DENIED';
export type VisitCategory = 'visitor' | 'attachee';

export interface PublicVisit {
  passNumber: string;
  status: VisitStatus;
  category: VisitCategory;
  visitorName: string;
  documentType: DocumentType;
  documentMasked: string;
  hostName: string | null;
  department: string;
  purpose: string | null;
  requestedAt: string;
  checkInAt: string | null;
  checkOutAt: string | null;
}

export interface StaffVisit extends PublicVisit {
  id: string;
  method: 'SELF' | 'RETURNING' | 'MANUAL';
  flagged: boolean;
  flagReason: string | null;
  watchlistHit: boolean;
  visitor: {
    id: string;
    fullName: string;
    documentType: DocumentType;
    documentMasked: string;
    nationality: string | null;
    phone: string;
  };
}

export interface AppConfig {
  orgName: string;
  departments: string[];
  consentVersion: string;
  retentionMonths: number;
  dpoContact: string;
}

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'security';
}
