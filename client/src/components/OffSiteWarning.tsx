import type { VisitCategory } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Alert } from './ui';

/** Warns before the visitor fills anything in that check-in will need the office Wi-Fi. */
export function OffSiteWarning({ category }: { category: VisitCategory }) {
  const status = useApi<{ required: boolean; onSite: boolean }>(`/public/onsite?category=${category}`);
  if (!status.data?.required || status.data.onSite) return null;
  return (
    <div className="mb-5">
      <Alert tone="warning" title="Connect to the NYS Wi-Fi">
        You need to be on the office Wi-Fi to check in. Turn off mobile data, join the NYS Wi-Fi, then reload this page.
      </Alert>
    </div>
  );
}
