import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type PublicVisit, type VisitCategory } from '../lib/api';
import { formatTime, STATUS_LABEL } from '../lib/format';
import { useApi, useConfig } from '../lib/hooks';
import { IconAttachee, IconVisitor } from '../components/icons';
import { emptyVisit, missingFields, VisitFields, visitPayload, type VisitValues } from '../components/VisitorFields';
import { Alert, Button, ChoiceButton, cx, FullPageSpinner, PageTitle, StatusBadge, VisitorShell } from '../components/ui';
import { OffSiteWarning } from '../components/OffSiteWarning';
import { FirstVisit } from './FirstVisit';

interface Me {
  visitor: { fullName: string; firstName: string } | null;
  openVisit?: PublicVisit | null;
  lastVisitDetails?: { category: VisitCategory; department: string; hostName: string | null; purpose: string | null } | null;
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function CheckIn() {
  const me = useApi<Me>('/public/me');
  const [mode, setMode] = useState<{ kind: 'home' } | { kind: 'first'; category: VisitCategory }>({ kind: 'home' });

  if (me.loading && !me.data) return <VisitorShell><FullPageSpinner /></VisitorShell>;
  if (me.error) {
    return (
      <VisitorShell>
        <Alert tone="error">{errorMessage(me.error)}</Alert>
      </VisitorShell>
    );
  }
  if (me.data?.visitor) return <Returning me={me.data} onChange={me.reload} />;
  if (mode.kind === 'first') return <FirstVisit category={mode.category} onExit={() => setMode({ kind: 'home' })} />;

  return (
    <VisitorShell>
      <PageTitle title={`${greeting()}`} subtitle="Check in here before you go in. Have your ID ready." />
      <div className="space-y-3">
        <ChoiceButton icon={IconVisitor} title="I'm visiting" subtitle="Here to see someone" emphasis onClick={() => setMode({ kind: 'first', category: 'visitor' })} />
        <ChoiceButton icon={IconAttachee} title="I'm an attachee" subtitle="On attachment here" onClick={() => setMode({ kind: 'first', category: 'attachee' })} />
      </div>

      <p className="mt-10 text-center text-sm text-slate-400">No smartphone? Reception can check you in.</p>
    </VisitorShell>
  );
}

function Returning({ me, onChange }: { me: Me; onChange: () => void }) {
  const navigate = useNavigate();
  const config = useConfig();
  const last = me.lastVisitDetails;
  const [visit, setVisit] = useState<VisitValues>(() => ({
    ...emptyVisit(last?.category ?? 'visitor'),
    department: last?.department ?? '',
  }));
  const [editing, setEditing] = useState(!last?.department);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = me.openVisit;
  const firstName = me.visitor!.firstName;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      navigate('/pass');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.passNumber) return navigate('/pass');
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setEditing(true);
    } finally {
      setBusy(false);
    }
  }

  function checkIn() {
    const missing = missingFields(null, visit);
    setErrors(missing);
    if (Object.keys(missing).length) {
      setEditing(true);
      return;
    }
    void run(() => api('/public/checkin/returning', { method: 'POST', body: visitPayload(visit) }));
  }

  async function forget() {
    await api('/public/forget', { method: 'POST' });
    onChange();
  }

  const notYou = (
    <p className="mt-8 text-center text-sm text-slate-400">
      Not {firstName}?{' '}
      <button className="font-semibold text-brand-600" onClick={() => void forget()}>
        Use a different identity
      </button>
    </p>
  );

  if (open) {
    return (
      <VisitorShell
        footer={
          <>
            {open.status === 'CHECKED_IN' && (
              <Button size="lg" loading={busy} onClick={() => void run(() => api('/public/checkout', { method: 'POST' }))}>
                Check out
              </Button>
            )}
            <Button size="lg" variant="secondary" onClick={() => navigate('/pass')}>
              Show my pass
            </Button>
          </>
        }
      >
        <PageTitle title={`Hi ${firstName}`} subtitle="You're checked in right now." />
        {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
        <div className="rounded-3xl border border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Current visit</span>
            <StatusBadge status={open.status} label={STATUS_LABEL[open.status]} />
          </div>
          <p className="mt-3 text-lg font-semibold">{open.department}</p>
          <p className="mt-3 text-sm text-slate-400">Checked in at</p>
          <p className="text-2xl font-bold tabular-nums">{formatTime(open.checkInAt ?? open.requestedAt)}</p>
        </div>
        {notYou}
      </VisitorShell>
    );
  }

  const isAttachee = visit.category === 'attachee';
  return (
    <VisitorShell
      footer={
        <Button size="lg" loading={busy} onClick={checkIn}>
          {isAttachee ? 'Check in for today' : 'Check in'}
        </Button>
      }
    >
      <PageTitle title={`Welcome back, ${firstName}`} subtitle={editing ? 'Choose today’s department.' : 'One tap and you are in.'} />

      {editing && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
          {(['visitor', 'attachee'] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setVisit({ ...visit, category: c });
                setErrors({});
              }}
              className={cx('h-10 rounded-xl text-sm font-semibold transition', visit.category === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
            >
              {c === 'visitor' ? 'Visitor' : 'Attachee'}
            </button>
          ))}
        </div>
      )}

      <OffSiteWarning category={visit.category} />
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

      {!editing && visit.department ? (
        <div className="rounded-3xl border border-slate-200 p-5">
          <p className="text-sm text-slate-400">{isAttachee ? 'Attached to' : 'Visiting'}</p>
          <p className="mt-1 text-lg font-semibold">{visit.department}</p>
          <button className="mt-4 text-sm font-semibold text-brand-600" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      ) : (
        <VisitFields value={visit} onChange={setVisit} errors={errors} departments={config?.departments ?? []} />
      )}
      {notYou}
    </VisitorShell>
  );
}
