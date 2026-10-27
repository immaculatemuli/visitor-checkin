import { useState } from 'react';
import { api, ApiError, errorMessage, type StaffVisit } from '../../lib/api';
import { useConfig } from '../../lib/hooks';
import {
  DocumentFields,
  documentPayload,
  emptyDocument,
  emptyVisit,
  missingFields,
  VisitFields,
  visitPayload,
  type DocumentValues,
  type VisitValues,
} from '../../components/VisitorFields';
import { Alert, Button, Card, cx } from '../../components/ui';

export default function ManualCheckIn() {
  const config = useConfig();
  const [doc, setDoc] = useState<DocumentValues>(emptyDocument('national_id'));
  const [visit, setVisit] = useState<VisitValues>(emptyVisit('visitor'));
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<StaffVisit | null>(null);

  async function submit() {
    const missing = missingFields(doc, visit);
    setErrors(missing);
    setError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      const res = await api<{ visit: StaffVisit }>('/admin/visits/manual', {
        method: 'POST',
        body: { ...documentPayload(doc), ...visitPayload(visit), consent },
      });
      setDone(res.visit);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDoc(emptyDocument('national_id'));
    setVisit(emptyVisit(visit.category));
    setConsent(false);
    setDone(null);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        {done.status === 'PENDING_APPROVAL' ? (
          <Alert tone="error" title="Watchlist match: approval required">
            {done.visitorName} is on the watchlist. Approve or deny entry from the Live page.
          </Alert>
        ) : (
          <Alert tone="success" title={`${done.visitorName} is checked in`}>
            Write this pass number on a paper visitor badge.
          </Alert>
        )}
        <Card className="text-center">
          <p className="text-xs uppercase tracking-wider text-slate-500">Pass number</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-wider">{done.passNumber}</p>
          <p className="mt-2 text-sm text-slate-600">
            {done.department}{done.hostName && ` · ${done.hostName}`}
          </p>
        </Card>
        <Button size="lg" onClick={reset}>
          Check in another visitor
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h1 className="text-xl font-bold">Manual check-in</h1>
        <p className="text-sm text-slate-600">For visitors without a smartphone. Copy the details from their physical ID or passport.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Document</h2>
          <DocumentFields value={doc} onChange={setDoc} errors={errors} showType />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Visit</h2>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(['visitor', 'attachee'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setVisit({ ...visit, category: c })}
                className={cx('h-9 rounded-lg text-sm font-semibold', visit.category === c ? 'bg-white shadow-sm' : 'text-slate-500')}
              >
                {c === 'visitor' ? 'Visitor' : 'Attachee'}
              </button>
            ))}
          </div>
          <VisitFields value={visit} onChange={setVisit} errors={errors} departments={config?.departments ?? []} extras />
        </Card>
      </div>

      <label className="flex items-start gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-800" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="text-sm">
          I have read the data-protection notice to the visitor (or shown them the printed copy) and they consent to their details being recorded.
          {errors.consent && <span className="mt-1 block text-red-600">{errors.consent}</span>}
        </span>
      </label>

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" size="lg" loading={busy} disabled={!consent}>
        Check in visitor
      </Button>
    </form>
  );
}
