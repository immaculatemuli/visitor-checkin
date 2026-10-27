import { useEffect, useState } from 'react';
import type { PublicVisit } from '../lib/api';
import { DOC_LABEL, formatDateTime, formatTime, publicUrl, STATUS_LABEL } from '../lib/format';
import { QrCode } from './QrCode';
import { cx, StatusBadge } from './ui';

/** A ticking clock so security can tell a live pass from a screenshot. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono tabular-nums">
      {new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)}
    </span>
  );
}

export function PassCard({ visit }: { visit: PublicVisit }) {
  const live = visit.status === 'CHECKED_IN';
  const isAttachee = visit.category === 'attachee';
  return (
    <div className={cx('overflow-hidden rounded-[28px] border bg-white', live ? 'border-brand-200 shadow-xl shadow-brand-600/10' : 'border-slate-200')}>
      <div className="flex items-center justify-between px-6 pt-6">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{isAttachee ? 'Attachee pass' : 'Visitor pass'}</span>
        <StatusBadge status={visit.status} label={STATUS_LABEL[visit.status]} />
      </div>

      <div className="px-6 pb-6 pt-4">
        <p className="text-[28px] font-bold leading-tight tracking-tight">{visit.visitorName}</p>
        <p className="mt-1 text-sm text-slate-400">
          {DOC_LABEL[visit.documentType]} {visit.documentMasked}
        </p>

        <dl className="mt-6 space-y-3 text-[15px]">
          <Row label="Department" value={visit.department} />
          {!isAttachee && visit.hostName && <Row label="Visiting" value={visit.hostName} />}
          <Row label="Date" value={formatDateTime(visit.checkInAt ?? visit.requestedAt).split(',')[0]} />
          <div className="grid grid-cols-2 gap-3">
            <Row label="Time in" value={formatTime(visit.checkInAt)} />
            <Row label="Time out" value={formatTime(visit.checkOutAt)} />
          </div>
        </dl>
      </div>

      <div className={cx('flex items-center justify-between gap-4 px-6 py-5', live ? 'border-t-4 border-nys-yellow bg-brand-600 text-white' : 'bg-slate-50')}>
        <div>
          <p className={cx('text-[11px] font-semibold uppercase tracking-[0.14em]', live ? 'text-white/70' : 'text-slate-400')}>Pass number</p>
          <p className="mt-0.5 font-mono text-xl font-bold tracking-wider">{visit.passNumber}</p>
          {live && (
            <p className="mt-2 flex items-center gap-2 text-sm text-white/90">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Live · <LiveClock />
            </p>
          )}
        </div>
        <div className="rounded-xl bg-white p-1.5">
          <QrCode value={publicUrl(`/admin/verify/${visit.passNumber}`)} size={84} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
