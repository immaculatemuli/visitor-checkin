import { Link, useParams } from 'react-router';
import type { StaffVisit } from '../../lib/api';
import { DOC_LABEL, formatDateTime, STATUS_LABEL } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Card, StatusBadge } from '../../components/ui';

export default function VerifyPass() {
  const { passNumber = '' } = useParams();
  const result = useApi<{ visit: StaffVisit }>(`/admin/visits/pass/${encodeURIComponent(passNumber)}`);
  const v = result.data?.visit;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link to="/admin" className="text-sm text-brand-800 underline">
        ← Back to live view
      </Link>
      {result.error && <Alert tone="error" title="Pass not found">{result.error.message}</Alert>}
      {v && (
        <>
          {v.status === 'CHECKED_IN' ? (
            <Alert tone="success" title="Valid pass: visitor is checked in" />
          ) : (
            <Alert tone="error" title={`Not valid for entry: ${STATUS_LABEL[v.status]}`} />
          )}
          <Card className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xl font-bold">{v.visitorName}</p>
                <p className="text-sm text-slate-500">
                  {DOC_LABEL[v.documentType]} {v.documentMasked} · {v.visitor.nationality}{v.visitor.phone && ` · ${v.visitor.phone}`}
                </p>
              </div>
              <StatusBadge status={v.status} label={STATUS_LABEL[v.status]} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Visiting</dt>
                <dd className="font-medium">{v.category === 'attachee' ? 'Attachee' : (v.hostName ?? '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Department</dt>
                <dd className="font-medium">{v.department}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Purpose</dt>
                <dd className="font-medium">{v.purpose ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Time in</dt>
                <dd className="font-medium">{formatDateTime(v.checkInAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Time out</dt>
                <dd className="font-medium">{formatDateTime(v.checkOutAt)}</dd>
              </div>
            </dl>
            <p className="font-mono text-sm">{v.passNumber}</p>
            {v.flagged && <Alert tone="warning">{v.flagReason}</Alert>}
            {v.watchlistHit && <Alert tone="error">This visitor matched the watchlist.</Alert>}
          </Card>
        </>
      )}
    </div>
  );
}
