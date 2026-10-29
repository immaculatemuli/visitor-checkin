import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type Staff } from '../lib/api';
import { publicUrl } from '../lib/format';
import { useApi } from '../lib/hooks';
import { QrCode } from '../components/QrCode';
import { Alert, Button, FullPageSpinner, NysStripe } from '../components/ui';

/**
 * A4 poster for the reception desk. Open it and print (Ctrl+P), or save as PDF. Staff only: the
 * QR carries the reception code, which is what proves a visitor is at the desk.
 */
export default function Poster() {
  const navigate = useNavigate();
  const me = useApi<{ staff: Staff }>('/auth/me');
  const reception = useApi<{ code: string; required: boolean }>('/admin/reception');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) navigate('/admin/login?next=/admin/poster', { replace: true });
  }, [me.error, navigate]);

  async function changeCode() {
    if (!confirm('Make a new code? The poster on the wall, and any photo of it, will stop working until you print this new one.')) return;
    setBusy(true);
    setError('');
    try {
      reception.setData(await api<{ code: string; required: boolean }>('/admin/reception/change', { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!me.data || !reception.data) return <FullPageSpinner />;
  const url = publicUrl(`/checkin?k=${encodeURIComponent(reception.data.code)}`);

  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <div className="no-print mx-auto flex max-w-[210mm] flex-wrap items-center justify-center gap-3 p-4">
        <Link to="/admin" className="mr-auto text-sm font-semibold text-brand-700">
          ← Dashboard
        </Link>
        {me.data.staff.role === 'admin' && (
          <Button variant="secondary" loading={busy} onClick={() => void changeCode()}>
            Make a new code
          </Button>
        )}
        <Button onClick={() => window.print()}>Print poster</Button>
        {error && <Alert tone="error">{error}</Alert>}
        <p className="w-full text-center text-xs text-slate-500">
          Visitors must scan this code at reception to check in. If a photo of it is shared, make a new code and reprint.
        </p>
      </div>
      <div className="mx-auto flex h-[297mm] w-[210mm] flex-col bg-white shadow-xl print:shadow-none">
        <NysStripe className="h-[4mm]" />
        <div className="flex flex-1 flex-col items-center px-[20mm] pb-[12mm] pt-[10mm] text-center">
          <img src="/nys-banner.png" alt="Republic of Kenya, National Youth Service" className="h-[26mm] w-auto" />
          <p className="mt-[6mm] text-[13pt] font-bold uppercase tracking-[0.18em] text-brand-700">National Youth Service Headquarters</p>
          <h1 className="mt-[3mm] text-[44pt] font-bold leading-none tracking-tight">Visitor Check-in</h1>
          <p className="mt-[5mm] text-[17pt] text-slate-500">Visitors and attachees, please check in before going in.</p>

          <div className="mt-[9mm] rounded-[10mm] border-[1.2mm] border-brand-600 p-[7mm]">
            <QrCode value={url} size={300} />
          </div>
          <p className="mt-[7mm] text-[20pt] font-semibold">Scan with your phone camera</p>
          <p className="mt-[2mm] text-[12pt] text-slate-400">Scan each time you arrive</p>

          <ol className="mt-auto grid w-full grid-cols-3 gap-[8mm]">
            {[
              ['1', 'Scan this code', 'No app needed'],
              ['2', 'Enter your ID details', 'Name, ID number and department'],
              ['3', 'Show your pass', 'Check out when you leave'],
            ].map(([n, title, sub]) => (
              <li key={n}>
                <span className="mx-auto flex h-[12mm] w-[12mm] items-center justify-center rounded-full bg-brand-600 text-[16pt] font-bold text-white">{n}</span>
                <p className="mt-[3mm] text-[13pt] font-semibold">{title}</p>
                <p className="text-[11pt] text-slate-500">{sub}</p>
              </li>
            ))}
          </ol>

          <p className="mt-[9mm] text-[10.5pt] text-slate-400">
            No smartphone? Please check in at the reception desk. Personal data is processed under the Kenya Data Protection Act, 2019.
          </p>
        </div>
        <NysStripe className="h-[4mm]" />
      </div>
    </div>
  );
}
