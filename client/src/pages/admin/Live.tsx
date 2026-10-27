import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, type StaffVisit } from '../../lib/api';
import { DOC_LABEL, formatTime } from '../../lib/format';
import { useApi, useInterval } from '../../lib/hooks';
import { Alert, Button, Card, cx, Input, Tag } from '../../components/ui';
import type { NetworksResponse } from './OfficeWifi';

interface Stats {
  visitorsInside: number;
  attacheesInside: number;
  pending: number;
  today: number;
  flagged: number;
}

type Filter = 'all' | 'visitor' | 'attachee';

export default function Live() {
  const navigate = useNavigate();
  const live = useApi<{ pending: StaffVisit[]; inside: StaffVisit[] }>('/admin/visits/live');
  const stats = useApi<Stats>('/admin/visits/stats');
  const networks = useApi<NetworksResponse>('/admin/networks');
  const [passLookup, setPassLookup] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    void live.reload();
    void stats.reload();
  }, [live.reload, stats.reload]);
  useInterval(refresh, 10_000);

  const pendingCount = live.data?.pending.length ?? 0;
  useEffect(() => {
    document.title = pendingCount ? `(${pendingCount}) Security alert · Visitor Check-in` : 'Live · Visitor Check-in';
  }, [pendingCount]);

  async function act(visit: StaffVisit, action: 'approve' | 'deny' | 'checkout') {
    let body: unknown = {};
    if (action === 'deny') {
      const reason = prompt(`Reason for denying entry to ${visit.visitorName}?`);
      if (reason === null) return;
      body = { reason };
    } else if (action === 'checkout' && !confirm(`Check out ${visit.visitorName}?`)) {
      return;
    }
    setBusyId(visit.id);
    setError('');
    try {
      await api(`/admin/visits/${visit.id}/${action}`, { method: 'POST', body });
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const inside = (live.data?.inside ?? [])
    .filter((v) => filter === 'all' || v.category === filter)
    .filter((v) => `${v.visitorName} ${v.passNumber} ${v.hostName ?? ''} ${v.department}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Live</h1>
        <p className="text-sm text-slate-500">Updates every 10 seconds.</p>
      </div>

      {networks.data && networks.data.networks.length === 0 && networks.data.policy !== 'off' && (
        <Alert tone="warning" title="Anyone can check in from anywhere">
          No office Wi-Fi has been added, so attachees could check in from home.{' '}
          <Link to="/admin/wifi" className="font-semibold underline">
            Set up office Wi-Fi
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Visitors inside" value={stats.data?.visitorsInside} />
        <Stat label="Attachees in" value={stats.data?.attacheesInside} />
        <Stat label="Awaiting security" value={stats.data?.pending} tone={stats.data?.pending ? 'warning' : undefined} />
        <Stat label="Not checked out" value={stats.data?.flagged} tone={stats.data?.flagged ? 'error' : undefined} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {pendingCount > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-red-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
            Watchlist alerts
          </h2>
          {live.data!.pending.map((v) => (
            <div key={v.id} className="flex flex-col gap-4 rounded-3xl border border-red-200 bg-red-50/60 p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="font-semibold">
                  {v.visitorName} {v.category === 'attachee' && <Tag tone="brand">Attachee</Tag>}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {DOC_LABEL[v.documentType]} {v.documentMasked}{v.visitor.phone && ` · ${v.visitor.phone}`} · {v.department}
                  {v.hostName && `, visiting ${v.hostName}`}
                </p>
                <p className="text-sm text-slate-400">
                  Requested {formatTime(v.requestedAt)} · {v.passNumber}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" loading={busyId === v.id} onClick={() => void act(v, 'deny')}>
                  Deny
                </Button>
                <Button loading={busyId === v.id} onClick={() => void act(v, 'approve')}>
                  Approve entry
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h2 className="font-semibold">On site now</h2>
          <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 text-sm sm:ml-4">
            {(['all', 'visitor', 'attachee'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cx('rounded-lg px-3 py-1.5 font-medium capitalize', filter === f ? 'bg-white shadow-sm' : 'text-slate-500')}
              >
                {f === 'all' ? 'All' : `${f}s`}
              </button>
            ))}
          </div>
          <Input placeholder="Search name, pass, department…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 sm:ml-auto sm:w-72" />
        </div>

        <Card className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr className="border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Department</th>
                <th className="px-5 py-3 font-medium">Time in</th>
                <th className="px-5 py-3 font-medium">Pass</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inside.map((v) => (
                <tr key={v.id} className={v.flagged ? 'bg-amber-50/60' : ''}>
                  <td className="px-5 py-3.5">
                    <p className="font-semibold">
                      {v.visitorName} {v.category === 'attachee' && <Tag tone="brand">Attachee</Tag>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {DOC_LABEL[v.documentType]} {v.documentMasked}{v.visitor.phone && ` · ${v.visitor.phone}`}
                    </p>
                    {v.flagged && <p className="mt-0.5 text-xs font-medium text-amber-700">{v.flagReason}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    {v.department}
                    {v.hostName && <p className="text-xs text-slate-400">Visiting {v.hostName}</p>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5">
                    {formatTime(v.checkInAt)}
                    {v.method === 'MANUAL' && <p className="text-xs text-slate-400">at desk</p>}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{v.passNumber}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Button size="sm" variant="outline" loading={busyId === v.id} onClick={() => void act(v, 'checkout')}>
                      Check out
                    </Button>
                  </td>
                </tr>
              ))}
              {live.data && inside.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    {search || filter !== 'all' ? 'No matches.' : 'Nobody is checked in.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (passLookup.trim()) navigate(`/admin/verify/${encodeURIComponent(passLookup.trim().toUpperCase())}`);
          }}
        >
          <label className="flex-1">
            <span className="mb-1.5 block text-sm font-medium text-slate-600">Verify a pass</span>
            <Input placeholder="VIS-261027-ABCD" value={passLookup} onChange={(e) => setPassLookup(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary" className="h-12">
            Look up
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Or scan the QR code on a pass with your phone camera.</p>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value?: number; tone?: 'warning' | 'error' }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={cx('mt-2 text-3xl font-bold tabular-nums tracking-tight', tone === 'error' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-slate-900')}>
        {value ?? '–'}
      </p>
    </Card>
  );
}
