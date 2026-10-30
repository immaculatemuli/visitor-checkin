import { useState } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Alert, Button, Card, Field, Input } from '../../components/ui';
import { useStaff } from './AdminLayout';

/** The signed-in staff member's own account: change password. */
export default function Account() {
  const staff = useStaff();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setMessage(null);
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: 'The two new passwords are different' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setMessage({ tone: 'success', text: 'Password changed. Use the new one next time you sign in.' });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h1 className="text-xl font-bold">My account</h1>
        <p className="text-sm text-slate-600">
          {staff.name} · {staff.email} · <span className="capitalize">{staff.role}</span>
        </p>
      </div>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="font-semibold">Change password</h2>
          <Field label="Current password" error={errors.currentPassword}>
            <Input type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="New password" error={errors.newPassword} hint="10+ characters, with letters and a number">
            <Input type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="New password again" error={errors.confirm}>
            <Input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </form>
      </Card>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}
