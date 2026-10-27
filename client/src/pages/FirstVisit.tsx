import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type DocumentType, type VisitCategory } from '../lib/api';
import { isExpired, type MrzResult } from '../lib/mrz';
import { warmUpOcr } from '../lib/ocr';
import { todayIso } from '../lib/format';
import { useConfig } from '../lib/hooks';
import { ConsentNotice } from '../components/ConsentNotice';
import { DocumentScanner } from '../components/DocumentScanner';
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
} from '../components/VisitorFields';
import { Alert, Button, FullPageSpinner, PageTitle, VisitorShell } from '../components/ui';

const STEPS = ['scan', 'details'] as const;
type Step = (typeof STEPS)[number];

function fromMrz(mrz: MrzResult, documentType: DocumentType): DocumentValues {
  return {
    documentType,
    fullName: mrz.fullName,
    documentNumber: documentType === 'national_id' ? mrz.idNumber : mrz.documentNumber,
    nationality: mrz.nationality || (documentType === 'national_id' ? 'KEN' : ''),
    dob: mrz.dateOfBirth ?? '',
    documentExpiry: mrz.expiryDate ?? '',
  };
}

/** First visit: photograph the ID, check the filled-in details, choose a department, check in. */
export function FirstVisit({ category, onExit }: { category: VisitCategory; onExit: () => void }) {
  const navigate = useNavigate();
  const config = useConfig();
  const [step, setStep] = useState<Step>('scan');
  const [doc, setDoc] = useState<DocumentValues>(emptyDocument('national_id'));
  const [visit, setVisit] = useState<VisitValues>(emptyVisit(category));
  const [scanned, setScanned] = useState<'ok' | 'check' | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void warmUpOcr().catch(() => {});
  }, []);

  if (!config) return <VisitorShell><FullPageSpinner /></VisitorShell>;

  const stepInfo = { current: STEPS.indexOf(step) + 1, total: STEPS.length };

  function handleScan(mrz: MrzResult) {
    // A passport is recognised from its MRZ, so there's no need to ask which document it is.
    const scannedType: DocumentType = mrz.format === 'TD3' ? 'passport' : 'national_id';
    setDoc(fromMrz(mrz, scannedType));
    setScanned(mrz.valid ? 'ok' : 'check');
    setStep('details');
  }

  const passportExpired =
    doc.documentType === 'passport' && !!doc.documentExpiry && isExpired(doc.documentExpiry, new Date(`${todayIso()}T00:00:00Z`));

  async function submit() {
    const missing = missingFields(doc, visit);
    setErrors(missing);
    setError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      // Tapping "Check in" under the notice below is the visitor's consent.
      await api('/public/checkin', {
        method: 'POST',
        body: { ...documentPayload(doc), ...visitPayload(visit), consent: true, consentVersion: config!.consentVersion },
      });
      navigate('/pass');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.passNumber) return navigate('/pass');
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'scan') {
    return (
      <VisitorShell onBack={onExit} step={stepInfo}>
        <DocumentScanner
          documentType={doc.documentType}
          onResult={handleScan}
          onManual={() => {
            setScanned(null);
            setStep('details');
          }}
        />
      </VisitorShell>
    );
  }

  return (
    <VisitorShell
      onBack={() => setStep('scan')}
      step={stepInfo}
      footer={
        <>
          <Button size="lg" loading={busy} disabled={passportExpired} onClick={() => void submit()}>
            Check in
          </Button>
          <p className="text-center text-xs text-slate-500">
            By checking in you agree to your details being used for access control.{' '}
            <button className="font-semibold text-brand-600" onClick={() => setShowNotice(!showNotice)}>
              {showNotice ? 'Hide privacy notice' : 'Privacy notice'}
            </button>
          </p>
        </>
      }
    >
      <PageTitle title="Confirm your details" subtitle={scanned ? 'We filled these in from your ID. Check them and choose your department.' : undefined} />

      <div className="space-y-4">
        {scanned === 'check' && <Alert tone="warning">Some details may have been misread. Please check each one carefully.</Alert>}
        {passportExpired && (
          <Alert tone="error" title="This passport has expired">
            We can't accept an expired passport. Please see the reception desk.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>

      <section className="mt-6">
        <VisitFields value={visit} onChange={setVisit} errors={errors} departments={config.departments} />
      </section>
      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Your details</h2>
        <DocumentFields value={doc} onChange={setDoc} errors={errors} showType={!scanned} />
      </section>
      {showNotice && (
        <section className="mt-8">
          <ConsentNotice config={config} />
        </section>
      )}
    </VisitorShell>
  );
}
