import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type DocumentType, type VisitCategory } from '../lib/api';
import { isExpired, type MrzResult } from '../lib/mrz';
import type { ScanResult } from '../lib/ocr';
import { todayIso } from '../lib/format';
import { useConfig } from '../lib/hooks';
import { ConsentNotice } from '../components/ConsentNotice';
import { DocumentScanner } from '../components/DocumentScanner';
import { IconCamera } from '../components/icons';
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

type Step = 'details' | 'scan';

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

/**
 * Fields whose check digit failed, so the visitor compares just those with the card. On a
 * Kenyan ID the national ID number sits in the optional data, which only the composite check
 * covers.
 */
function uncertainFields(mrz: MrzResult, documentType: DocumentType): Record<string, string> {
  const hint = 'This may have been misread. Check it against your document.';
  const e: Record<string, string> = {};
  const numberOk =
    documentType === 'passport'
      ? mrz.checks.documentNumber
      : mrz.checks.composite || (mrz.idNumber === mrz.documentNumber && mrz.checks.documentNumber);
  if (!numberOk) e.documentNumber = hint;
  if (!mrz.checks.dateOfBirth) e.dob = hint;
  if (documentType === 'passport' && !mrz.checks.expiryDate) e.documentExpiry = hint;
  return e;
}

/**
 * First visit: type the details from the ID (or fill them in from a photo of it), choose a
 * department, check in.
 */
export function FirstVisit({ category, onExit }: { category: VisitCategory; onExit: () => void }) {
  const navigate = useNavigate();
  const config = useConfig();
  const [step, setStep] = useState<Step>('details');
  const [doc, setDoc] = useState<DocumentValues>(emptyDocument('national_id'));
  const [visit, setVisit] = useState<VisitValues>(emptyVisit(category));
  // How the details were filled in: a fully verified MRZ, an MRZ with failed checks, or the front.
  const [scanned, setScanned] = useState<'ok' | 'check' | 'front' | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!config) return <VisitorShell><FullPageSpinner /></VisitorShell>;

  function handleScan(result: ScanResult) {
    if (result.kind === 'front') {
      // The printed front has no check digits, so the visitor is asked to look the details over.
      const { fullName, idNumber, dateOfBirth } = result.front;
      setDoc({ ...emptyDocument('national_id'), fullName, documentNumber: idNumber, dob: dateOfBirth ?? '' });
      const field = { fullName: 'fullName', idNumber: 'documentNumber', dateOfBirth: 'dob' } as const;
      const hint = (f: keyof typeof field) =>
        result.front[f] ? 'This may have been misread. Check it against your ID.' : "We couldn't read this. Please type it in.";
      setErrors(Object.fromEntries(result.uncertain.map((f) => [field[f], hint(f)])));
      setScanned(result.uncertain.length ? 'check' : 'front');
    } else {
      // A passport is recognised from its MRZ, so there's no need to ask which document it is.
      const { mrz } = result;
      const scannedType: DocumentType = mrz.format === 'TD3' ? 'passport' : 'national_id';
      setDoc(fromMrz(mrz, scannedType));
      setScanned(mrz.valid ? 'ok' : 'check');
      setErrors(uncertainFields(mrz, scannedType));
    }
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
      <VisitorShell onBack={() => setStep('details')}>
        <DocumentScanner documentType={doc.documentType} onResult={handleScan} onManual={() => setStep('details')} />
      </VisitorShell>
    );
  }

  return (
    <VisitorShell
      onBack={onExit}
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
      <PageTitle
        title={scanned ? 'Confirm your details' : 'Your details'}
        subtitle={scanned ? 'We filled these in from your ID. Check them and choose your department.' : 'Type them as they appear on your ID.'}
      />

      {!scanned && (
        <button
          type="button"
          onClick={() => setStep('scan')}
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-left text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
        >
          <IconCamera className="h-5 w-5 shrink-0" />
          Fill this in from a photo of my ID (optional)
        </button>
      )}

      <div className="space-y-4">
        {scanned === 'check' && <Alert tone="warning">Please check the highlighted details against your document.</Alert>}
        {scanned === 'front' && <Alert tone="info">Please check your name, ID number and date of birth match your ID.</Alert>}
        {passportExpired && (
          <Alert tone="error" title="This passport has expired">
            We can't accept an expired passport. Please see the reception desk.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>

      <section className="mt-6">
        <DocumentFields value={doc} onChange={setDoc} errors={errors} showType={!scanned} />
      </section>
      <section className="mt-6">
        <VisitFields value={visit} onChange={setVisit} errors={errors} departments={config.departments} />
      </section>
      {showNotice && (
        <section className="mt-8">
          <ConsentNotice config={config} />
        </section>
      )}
    </VisitorShell>
  );
}
