import { useState } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Button, Card, Field, Input, Select } from '../../components/ui';
import { useStaff } from './AdminLayout';

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'security';
  active: boolean;
  lastLoginAt: string | null;
}

const blank = { name: '', email: '', role: 'security' as const, password: '' };

export default function StaffPage() {
  const me = useStaff();
  const list = useApi<{ staff: StaffRow[] }>('/admin/staff');
  const [form, setForm] = useState<{ name: string; email: string; role: 'admin' | 'security'; password: string }>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await api('/admin/staff', { method: 'POST', body: form });
      setForm(blank);
      setMessage({ tone: 'success', text: 'Account created. Share the password with them securely.' });
      void list.reload();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function update(row: StaffRow, patch: Partial<Pick<StaffRow, 'role' | 'active'>> & { password?: string }) {
    setMessage(null);
    try {
      await api(`/admin/staff/${row.id}`, { method: 'PATCH', body: patch });
      if (patch.password) setMessage({ tone: 'success', text: `Password reset for ${row.name}.` });
      void list.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Staff accounts</h1>

      <Card>
        <form
          className="grid gap-3 md:grid-cols-5 md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Name" error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'security' })}>
              <option value="security">Security / reception</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Initial password" error={errors.password} hint="10+ characters, letters and a number">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={busy}>
            Add staff
          </Button>
        </form>
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Last sign-in</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.staff.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'text-slate-400'}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs">{s.email}</p>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={s.role}
                    disabled={s.id === me.id}
                    onChange={(e) => void update(s, { role: e.target.value as StaffRow['role'] })}
                    className="w-40"
                  >
                    <option value="security">Security</option>
                    <option value="admin">Admin</option>
                  </Select>
                </td>
                <td className="px-4 py-3">{formatDateTime(s.lastLoginAt)}</td>
                <td className="px-4 py-3">{s.active ? 'Active' : 'Deactivated'}</td>
                <td className="space-x-1 whitespace-nowrap px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const password = prompt(`New password for ${s.name} (10+ characters, letters and a number):`);
                      if (password) void update(s, { password });
                    }}
                  >
                    Reset password
                  </Button>
                  {s.id !== me.id && (
                    <Button size="sm" variant={s.active ? 'ghost' : 'secondary'} onClick={() => void update(s, { active: !s.active })}>
                      {s.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
