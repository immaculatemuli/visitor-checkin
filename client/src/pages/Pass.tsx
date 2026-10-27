import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, errorMessage, type PublicVisit } from '../lib/api';
import { formatTime } from '../lib/format';
import { useApi, useInterval } from '../lib/hooks';
import { PassCard } from '../components/PassCard';
import { Alert, Button, FullPageSpinner, PageTitle, VisitorShell } from '../components/ui';

export default function Pass() {
  const navigate = useNavigate();
  const pass = useApi<{ visit: PublicVisit }>('/public/pass');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visit = pass.data?.visit;

  // While waiting for security, poll so the pass updates as soon as it's approved.
  const poll = useCallback(() => void pass.reload(), [pass.reload]);
  useInterval(poll, visit?.status === 'PENDING_APPROVAL' ? 5000 : null);

  async function checkOut() {
    if (!confirm('Check out now? Do this when you are leaving.')) return;
    setBusy(true);
    setError('');
    try {
      pass.setData(await api<{ visit: PublicVisit }>('/public/checkout', { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (pass.loading && !visit) return <VisitorShell><FullPageSpinner /></VisitorShell>;

  if (pass.error || !visit) {
    const unknown = pass.error instanceof ApiError && (pass.error.status === 401 || pass.error.status === 404);
    return (
      <VisitorShell footer={<Button size="lg" onClick={() => navigate('/checkin')}>Go to check-in</Button>}>
        <PageTitle title="No pass yet" subtitle={unknown ? 'Check in first and your pass will appear here.' : errorMessage(pass.error)} />
      </VisitorShell>
    );
  }

  const footer =
    visit.status === 'CHECKED_IN' ? (
      <Button size="lg" variant="secondary" loading={busy} onClick={() => void checkOut()}>
        Check out
      </Button>
    ) : visit.status !== 'PENDING_APPROVAL' ? (
      <Button size="lg" onClick={() => navigate('/checkin')}>
        Done
      </Button>
    ) : undefined;

  const title = {
    CHECKED_IN: "You're checked in",
    PENDING_APPROVAL: 'Almost there',
    CHECKED_OUT: 'See you next time',
    DENIED: 'Entry not approved',
  }[visit.status];

  return (
    <VisitorShell footer={footer} onBack={() => navigate('/checkin')}>
      <PageTitle
        title={title}
        subtitle={
          visit.status === 'CHECKED_IN'
            ? 'Show this pass to security when asked.'
            : visit.status === 'CHECKED_OUT'
              ? `You checked out at ${formatTime(visit.checkOutAt)}. Thank you.`
              : undefined
        }
      />
      <div className="space-y-4">
        {visit.status === 'PENDING_APPROVAL' && (
          <Alert tone="warning" title="Please go to the security desk">
            Security needs to confirm your check-in. Show them this screen. It updates by itself.
          </Alert>
        )}
        {visit.status === 'DENIED' && <Alert tone="error">Please speak to the security desk.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <PassCard visit={visit} />
      </div>
    </VisitorShell>
  );
}
