import { useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Button, Card } from '../../components/ui';

interface Log {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  staff: { name: string; email: string } | null;
}

function describe(details: Log['details']): string {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function Audit() {
  const [page, setPage] = useState(1);
  const result = useApi<{ total: number; pageSize: number; logs: Log[] }>(`/admin/audit?page=${page}`);
  const pages = result.data ? Math.max(1, Math.ceil(result.data.total / result.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Audit log</h1>
        <p className="text-sm text-slate-600">Every staff action: sign-ins, approvals, manual check-ins, watchlist changes, exports and searches.</p>
      </div>
      {result.error && <Alert tone="error">{result.error.message}</Alert>}
      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.data?.logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(l.createdAt)}</td>
                <td className="px-4 py-3">{l.staff?.name ?? <span className="text-slate-400">System</span>}</td>
                <td className="px-4 py-3 font-mono text-xs">{l.action}</td>
                <td className="px-4 py-3 text-slate-600">{describe(l.details)}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-end gap-2 text-sm">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
