import { useState } from 'react';
import { Link } from 'react-router';
import { apiUrl } from '../../lib/api';
import { todayIso } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Button, Card, cx, Field, Input } from '../../components/ui';

interface Row {
  visitorId: string;
  name: string;
  documentMasked: string;
  department: string;
  daysPresent: number;
  attendancePct: number;
  totalMinutes: number;
  averageMinutesPerDay: number;
  lateArrivals: number;
  missedCheckouts: number;
  firstDay: string;
  lastDay: string;
  insideNow: boolean;
}

interface Report {
  from: string;
  to: string;
  workingDays: number;
  startTime: string;
  rows: Row[];
}

type Category = 'attachee' | 'visitor';

function hours(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

const firstOfMonth = () => `${todayIso().slice(0, 8)}01`;
const buttonLink = 'inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-slate-200 hover:bg-slate-50';

/** Attendance per attachee (or visitor) for a date range, with Excel/PDF export. */
export default function Attendance() {
  const [draft, setDraft] = useState({ from: firstOfMonth(), to: todayIso() });
  const [range, setRange] = useState(draft);
  const [category, setCategory] = useState<Category>('attachee');
  const query = `from=${range.from}&to=${range.to}&category=${category}`;
  const report = useApi<Report>(`/admin/reports/attendance?${query}`);
  const r = report.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Attendance</h1>
        <p className="text-sm text-slate-600">
          Days present, hours on site, late arrivals and missed check-outs for each person over a period. For individual visits, use{' '}
          <Link to="/admin/history" className="font-semibold text-brand-700">
            History
          </Link>
          .
        </p>
      </div>

      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setRange(draft);
          }}
        >
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {(['attachee', 'visitor'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cx('h-9 rounded-lg px-3 font-semibold', category === c ? 'bg-white shadow-sm' : 'text-slate-500')}
              >
                {c === 'attachee' ? 'Attachees' : 'Visitors'}
              </button>
            ))}
          </div>
          <Field label="From">
            <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
          <Button type="submit">Show</Button>
          <div className="ml-auto flex gap-2">
            <a className={buttonLink} href={apiUrl(`/admin/reports/attendance/export/csv?${query}`)}>
              Excel (CSV)
            </a>
            <a className={buttonLink} href={apiUrl(`/admin/reports/attendance/export/pdf?${query}`)}>
              PDF
            </a>
          </div>
        </form>
      </Card>

      {report.error && <Alert tone="error">{report.error.message}</Alert>}
      {r && (
        <p className="text-sm text-slate-500">
          {r.rows.length} {category === 'attachee' ? 'attachee' : 'visitor'}
          {r.rows.length === 1 ? '' : 's'} · {r.workingDays} working day{r.workingDays === 1 ? '' : 's'} (Mon–Fri) so far in this period ·
          late means first check-in after {r.startTime}
        </p>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Days present</th>
              <th className="px-4 py-3 font-medium">Total hours</th>
              <th className="px-4 py-3 font-medium">Average a day</th>
              <th className="px-4 py-3 font-medium">Late</th>
              <th className="px-4 py-3 font-medium">Missed check-out</th>
              <th className="px-4 py-3 font-medium">First / last day</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r?.rows.map((row) => (
              <tr key={row.visitorId}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.name}</p>
                  <p className="text-xs text-slate-400">
                    National ID {row.documentMasked}
                    {row.insideNow && <span className="ml-1 font-medium text-brand-700">· inside now</span>}
                  </p>
                </td>
                <td className="px-4 py-3">{row.department}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="font-semibold">{row.daysPresent}</span>
                  {r.workingDays > 0 && <span className="text-slate-400"> / {r.workingDays} · {row.attendancePct}%</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{hours(row.totalMinutes)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{hours(row.averageMinutesPerDay)}</td>
                <td className={cx('px-4 py-3', row.lateArrivals > 0 && 'font-semibold text-amber-700')}>{row.lateArrivals}</td>
                <td className={cx('px-4 py-3', row.missedCheckouts > 0 && 'font-semibold text-amber-700')}>{row.missedCheckouts}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {row.firstDay}
                  {row.lastDay !== row.firstDay && <> → {row.lastDay}</>}
                </td>
              </tr>
            ))}
            {r?.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  Nobody checked in during this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">
        Total hours count only visits that were checked out properly; a missed check-out still counts as a day present.
      </p>
    </div>
  );
}
