import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type DocumentType, type VisitCategory } from '../lib/api';
import { isExpired, type MrzResult } from '../lib/mrz';
import { warmUpOcr } from '../lib/ocr';
import { todayIso } from '../lib/format';
import { useConfig } from '../lib/hooks';
import { ConsentNotice } from '../components/ConsentNotice';
import { DocumentScanner } from '../components/DocumentScanner';
import { IconCard, IconPassport } from '../components/icons';
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
import { Alert, Button, ChoiceButton, FullPageSpinner, PageTitle, VisitorShell } from '../components/ui';

const STEPS = ['consent', 'type', 'scan', 'details'] as const;
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

export function FirstVisit({ category, onExit }: { category: VisitCategory; onExit: () => void }) {
  const navigate = useNavigate();
  const config = useConfig();
  const [step, setStep] = useState<Step>('consent');
  const [consent, setConsent] = useState(false);
  const [doc, setDoc] = useState<DocumentValues>(emptyDocument('national_id'));
  const [visit, setVisit] = useState<VisitValues>(emptyVisit(category));
  const [scanned, setScanned] = useState<'ok' | 'check' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Start loading the OCR engine while the visitor reads the notice, so scanning starts instantly.
  useEffect(() => {
    void warmUpOcr().catch(() => {});
  }, []);

  if (!config) return <VisitorShell><FullPageSpinner /></VisitorShell>;

  const stepInfo = { current: STEPS.indexOf(step) + 1, total: STEPS.length };
  const back = () => {
    const i = STEPS.indexOf(step);
    if (i === 0) onExit();
    else setStep(STEPS[i - 1]);
  };

  function handleScan(mrz: MrzResult) {
    // Trust the document over the button the visitor pressed.
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

  if (step === 'consent') {
    return (
      <VisitorShell
        onBack={back}
        step={stepInfo}
        footer={
          <>
            <label className="flex items-start gap-3 py-1">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-sm text-slate-600">I have read this and agree to my details being used for check-in.</span>
            </label>
            <Button size="lg" disabled={!consent} onClick={() => setStep('type')}>
              Continue
            </Button>
          </>
        }
      >
        <PageTitle title="Your privacy" />
        <ConsentNotice config={config} />
      </VisitorShell>
    );
  }

  if (step === 'type') {
    const choose = (type: DocumentType) => {
      setDoc(emptyDocument(type));
      setStep('scan');
    };
    return (
      <VisitorShell onBack={back} step={stepInfo}>
        <PageTitle title="Which document do you have?" subtitle="We'll read your details from it, so there's less to type." />
        <div className="space-y-3">
          <ChoiceButton icon={IconCard} title="Kenyan National ID" subtitle="Maisha card or older ID" onClick={() => choose('national_id')} />
          <ChoiceButton icon={IconPassport} title="Passport" subtitle="Any country" onClick={() => choose('passport')} />
        </div>
      </VisitorShell>
    );
  }

  if (step === 'scan') {
    return (
      <VisitorShell onBack={back} step={stepInfo}>
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
      onBack={back}
      step={stepInfo}
      footer={
        <Button size="lg" loading={busy} disabled={passportExpired} onClick={() => void submit()}>
          Check in
        </Button>
      }
    >
      <PageTitle title="Confirm your details" subtitle={scanned ? 'We filled these in from your document. Please check them.' : undefined} />

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
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">You</h2>
        <DocumentFields value={doc} onChange={setDoc} errors={errors} showType={!scanned} />
      </section>
      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">{category === 'attachee' ? 'Attachment' : 'Your visit'}</h2>
        <VisitFields value={visit} onChange={setVisit} errors={errors} departments={config.departments} />
      </section>
    </VisitorShell>
  );
}
