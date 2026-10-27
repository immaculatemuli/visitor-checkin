import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Alert, Button, Field, Input, PageTitle, VisitorShell } from '../components/ui';

export function OtpLogin({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const request = () =>
    run(async () => {
      await api('/public/otp/request', { method: 'POST', body: { phone } });
      setSent(true);
    });

  const verify = () =>
    run(async () => {
      await api('/public/otp/verify', { method: 'POST', body: { phone, code } });
      onDone();
    });

  return (
    <VisitorShell
      onBack={sent ? () => { setSent(false); setCode(''); } : onBack}
      footer={
        <Button size="lg" loading={busy} disabled={sent ? code.length !== 6 : phone.trim().length < 9} onClick={() => void (sent ? verify() : request())}>
          {sent ? 'Verify' : 'Send code'}
        </Button>
      }
    >
      {sent ? (
        <>
          <PageTitle title="Enter your code" subtitle={<>If {phone} is registered, we've sent it a 6-digit code.</>} />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            className="h-16 text-center font-mono text-3xl tracking-[0.6em]"
            autoFocus
          />
          <button className="mt-4 text-sm font-semibold text-brand-600" onClick={() => void request()}>
            Send a new code
          </button>
        </>
      ) : (
        <>
          <PageTitle title="Welcome back" subtitle="Enter the phone number you used last time and we'll text you a code." />
          <Field label="Phone number">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel" autoFocus />
          </Field>
          <p className="mt-4 text-sm text-slate-400">Changed your number? Go back and check in as a new visitor.</p>
        </>
      )}
      {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}
    </VisitorShell>
  );
}
