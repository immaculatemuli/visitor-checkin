import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { Alert, Button, Field, Input, Logo } from '../../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      const next = params.get('next');
      navigate(next?.startsWith('/admin') ? next : '/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <form
        className="w-full max-w-sm space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Logo />
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Staff sign in</h1>
          <p className="mt-1 text-slate-500">Security and reception only.</p>
        </div>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button size="lg" type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
