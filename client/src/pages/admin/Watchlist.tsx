import { useState } from 'react';
import { api, ApiError, errorMessage, type DocumentType } from '../../lib/api';
import { DOC_LABEL, formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Button, Card, Field, Input, Select } from '../../components/ui';
import { useStaff } from './AdminLayout';

interface Entry {
  id: string;
  documentType: DocumentType;
  documentMasked: string;
  reason: string;
  addedBy: string | null;
  createdAt: string;
}

export default function Watchlist() {
  const staff = useStaff();
  const list = useApi<{ entries: Entry[] }>('/admin/watchlist');
  const [form, setForm] = useState({ documentType: 'national_id' as DocumentType, documentNumber: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await api<{ flaggedInside: number }>('/admin/watchlist', { method: 'POST', body: form });
      setForm({ ...form, documentNumber: '', reason: '' });
      setMessage(
        res.flaggedInside
          ? { tone: 'warning', text: `Added. This person is currently inside (${res.flaggedInside} visit flagged on the Live page).` }
          : { tone: 'success', text: 'Added to the watchlist. Their next self check-in will need security approval.' },
      );
      void list.reload();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    if (!confirm(`Remove ${DOC_LABEL[entry.documentType]} ${entry.documentMasked} from the watchlist?`)) return;
    try {
      await api(`/admin/watchlist/${entry.id}`, { method: 'DELETE' });
      void list.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Watchlist</h1>
        <p className="text-sm text-slate-600">
          Visitors with these documents can't check themselves in. Security gets an alert and has to approve entry.
        </p>
      </div>

      <Card>
        <form
          className="grid gap-3 md:grid-cols-[180px_1fr_2fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Document type">
            <Select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as DocumentType })}>
              <option value="national_id">National ID</option>
              <option value="passport">Passport</option>
            </Select>
          </Field>
          <Field label="Document number" error={errors.documentNumber}>
            <Input value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value.toUpperCase() })} autoComplete="off" />
          </Field>
          <Field label="Reason" error={errors.reason}>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <Button type="submit" loading={busy}>
            Add
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          The full number is not stored. It is hashed so it can be matched, and only the last 4 characters are kept for display.
        </p>
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.entries.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-medium">
                  {DOC_LABEL[e.documentType]} {e.documentMasked}
                </td>
                <td className="px-4 py-3">{e.reason}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(e.createdAt)}
                  {e.addedBy && <p className="text-xs">by {e.addedBy}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  {staff.role === 'admin' && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(e)}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {list.data?.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  The watchlist is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
