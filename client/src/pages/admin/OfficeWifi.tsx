import { useState } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { Alert, Button, Card, Field, Input } from '../../components/ui';
import { useStaff } from './AdminLayout';

export interface NetworksResponse {
  policy: 'attachee' | 'all' | 'off';
  current: { network: string | null; recognised: boolean };
  networks: { id: string; network: string; label: string; addedBy: string | null; createdAt: string }[];
  /** Networks check-ins were refused from in the last week, not yet approved. */
  blocked: { network: string; attempts: number; lastAt: string; names: string[] }[];
}

const POLICY_TEXT: Record<NetworksResponse['policy'], string> = {
  attachee: 'Attachees must be on the office Wi-Fi to check in. Visitors can check in on any network.',
  all: 'Everyone must be on the office Wi-Fi to check in.',
  off: 'The Wi-Fi check is switched off (ONSITE_CHECKIN=off), so anyone can check in from anywhere.',
};

export default function OfficeWifi() {
  const staff = useStaff();
  const data = useApi<NetworksResponse>('/admin/networks');
  const [label, setLabel] = useState('NYS HQ Wi-Fi');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = staff.role === 'admin';
  const d = data.data;

  async function addThisNetwork() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await api('/admin/networks', { method: 'POST', body: { label } });
      setMessage({ tone: 'success', text: 'Added. Check-ins from this Wi-Fi are now recognised as on site.' });
      void data.reload();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function approve(b: NetworksResponse['blocked'][number]) {
    if (!confirm(`Approve ${b.network} as an office network? Only do this if these check-ins really came from the office Wi-Fi.`)) return;
    setMessage(null);
    try {
      await api('/admin/networks', { method: 'POST', body: { label: 'NYS office Wi-Fi (approved)', network: b.network } });
      setMessage({ tone: 'success', text: 'Approved. Check-ins from that network now work.' });
      void data.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function remove(n: NetworksResponse['networks'][number]) {
    if (!confirm(`Remove "${n.label}"? Check-ins from it will no longer count as on site.`)) return;
    try {
      await api(`/admin/networks/${n.id}`, { method: 'DELETE' });
      void data.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Office Wi-Fi</h1>
        <p className="text-sm text-slate-600">
          Stops people checking in from home: check-in only works on the networks listed here. Everyone on the same office Wi-Fi shares
          one internet address, so adding it once covers every phone on it.
        </p>
      </div>

      {d && <Alert tone="info">{d.networks.length ? POLICY_TEXT[d.policy] : 'No office network added yet, so check-ins are not restricted. Add one below.'}</Alert>}

      <Card>
        <h2 className="font-semibold">The network you're on now</h2>
        {d && (
          <p className="mt-1 text-sm text-slate-600">
            {d.current.recognised ? (
              <span className="font-semibold text-brand-700">This is a recognised office network.</span>
            ) : (
              <>This network is not on the list{d.current.network ? ` (internet address ${d.current.network})` : ''}.</>
            )}
          </p>
        )}
        {isAdmin && d && !d.current.recognised && (
          <form
            className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void addThisNetwork();
            }}
          >
            <Field label="Name for this network" error={errors.label}>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy}>
              Add the network I'm on now
            </Button>
          </form>
        )}
        {isAdmin && d && !d.current.recognised && (
          <p className="mt-2 text-xs text-slate-500">
            Make sure this device is connected to the NYS office Wi-Fi (not mobile data or a hotspot) before adding it.
          </p>
        )}
        {!isAdmin && <p className="mt-2 text-xs text-slate-500">Only admins can add or remove networks.</p>}
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {d && d.blocked.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="px-4 pt-4">
            <h2 className="font-semibold">Refused recently</h2>
            <p className="text-sm text-slate-600">
              Check-ins refused in the last 7 days. If people were refused while on the office Wi-Fi, the office has another internet
              address: approve it here.
            </p>
          </div>
          <table className="mt-3 min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Internet address</th>
                <th className="px-4 py-3">Who was refused</th>
                <th className="px-4 py-3">Last attempt</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.blocked.map((b) => (
                <tr key={b.network}>
                  <td className="px-4 py-3 font-mono text-xs">{b.network}</td>
                  <td className="px-4 py-3">
                    {b.names.join(', ')}
                    <span className="text-slate-500">
                      {' '}
                      · {b.attempts} attempt{b.attempts === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(b.lastAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && (
                      <Button size="sm" variant="outline" onClick={() => void approve(b)}>
                        Approve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Network</th>
              <th className="px-4 py-3">Internet address</th>
              <th className="px-4 py-3">Added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d?.networks.map((n) => (
              <tr key={n.id}>
                <td className="px-4 py-3 font-medium">{n.label}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{n.network}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(n.createdAt)}
                  {n.addedBy && <p className="text-xs">by {n.addedBy}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(n)}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {d?.networks.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  No office networks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">
        Blocked attempts are recorded in the Audit log as "OFFSITE_CHECKIN_BLOCKED", with the person's name. If the office changes internet
        provider, add the new network here.
      </p>
    </div>
  );
}
