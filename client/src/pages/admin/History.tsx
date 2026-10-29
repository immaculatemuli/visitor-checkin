import { useState } from 'react';
import { apiUrl, type StaffVisit } from '../../lib/api';
import { DOC_LABEL, formatDateTime, formatDuration, STATUS_LABEL, todayIso } from '../../lib/format';
import { useApi, useConfig } from '../../lib/hooks';
import { Alert, Button, Card, Field, Input, Select, StatusBadge, Tag } from '../../components/ui';

interface Filters {
  from: string;
  to: string;
  name: string;
  document: string;
  department: string;
  status: string;
  category: string;
}

const initial: Filters = { from: todayIso(), to: todayIso(), name: '', document: '', department: '', status: '', category: '' };

function toQuery(f: Filters, page?: number): string {
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  if (page) params.set('page', String(page));
  return params.toString();
}

export default function History() {
  const config = useConfig();
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);
  const [page, setPage] = useState(1);
  const result = useApi<{ total: number; pageSize: number; visits: StaffVisit[] }>(`/admin/visits?${toQuery(filters, page)}`);

  const set = (patch: Partial<Filters>) => setDraft({ ...draft, ...patch });
  const pages = result.data ? Math.max(1, Math.ceil(result.data.total / result.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Visit history</h1>

      <Card>
        <form
          className="grid grid-cols-2 gap-3 md:grid-cols-7 md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilters(draft);
          }}
        >
          <Field label="From">
            <Input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Document no.">
            <Input value={draft.document} onChange={(e) => set({ document: e.target.value })} placeholder="Full or last 4" />
          </Field>
          <Field label="Department">
            <Select value={draft.department} onChange={(e) => set({ department: e.target.value })}>
              <option value="">All</option>
              {config?.departments.map((d) => <option key={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={draft.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All</option>
              <option value="visitor">Visitors</option>
              <option value="attachee">Attachees</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2 flex flex-wrap gap-2 md:col-span-7">
            <Button type="submit">Search</Button>
            <Button type="button" variant="ghost" onClick={() => { setDraft({ ...initial, from: '', to: '' }); }}>
              Clear
            </Button>
            <div className="ml-auto flex gap-2">
              <a className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-slate-200 hover:bg-slate-50" href={apiUrl(`/admin/visits/export/csv?${toQuery(filters)}`)}>
                Export CSV
              </a>
              <a className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-slate-200 hover:bg-slate-50" href={apiUrl(`/admin/visits/export/pdf?${toQuery(filters)}`)}>
                Export PDF
              </a>
            </div>
          </div>
        </form>
      </Card>

      {result.error && <Alert tone="error">{result.error.message}</Alert>}

      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">In</th>
              <th className="px-4 py-3">Out</th>
              <th className="px-4 py-3">Stayed</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.data?.visits.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold">
                    {v.visitorName} {v.category === 'attachee' && <Tag tone="brand">Attachee</Tag>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {DOC_LABEL[v.documentType]} {v.documentMasked}{v.visitor.phone && ` · ${v.visitor.phone}`}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {v.department}
                  {v.hostName && <p className="text-xs text-slate-500">Visiting {v.hostName}</p>}
                  {v.purpose && <p className="max-w-xs text-xs text-slate-500">{v.purpose}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(v.checkInAt)}</td>
                <td className="whitespace-nowrap px-4 py-3">{v.status === 'CHECKED_IN' ? 'Still inside' : formatDateTime(v.checkOutAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDuration(v.checkInAt, v.checkOutAt)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={v.status} label={STATUS_LABEL[v.status]} />
                  {v.flagged && <p className="mt-1 text-xs text-amber-800">⚠ {v.flagReason}</p>}
                  {v.watchlistHit && <p className="mt-1 text-xs text-red-700">Watchlist match</p>}
                </td>
              </tr>
            ))}
            {result.data?.visits.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No visits match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {result.data && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <p>{result.data.total} visit(s)</p>
          <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}
