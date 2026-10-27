import type { AppConfig } from '../lib/api';

/** Data-protection notice under the Kenya Data Protection Act, 2019 (sections 25, 26 and 29). */
export function ConsentNotice({ config }: { config: AppConfig }) {
  const org = config.orgName || 'This institution';
  const contact = config.dpoContact || 'the reception desk';
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-slate-600">
      <p>
        {org} collects your details to manage access and keep the premises secure, under the{' '}
        <span className="font-medium text-slate-900">Kenya Data Protection Act, 2019</span>.
      </p>
      <div>
        <p className="font-semibold text-slate-900">What we keep</p>
        <ul className="mt-1.5 space-y-1">
          <li>• Your name, date of birth and nationality</li>
          <li>• Your ID or passport number, stored in protected form. Staff only see the last 4 digits</li>
          <li>• Your phone number and your visit times</li>
        </ul>
      </div>
      <div className="rounded-2xl bg-brand-50 p-4 text-brand-900">
        <p className="font-semibold">Your document photo stays on your phone</p>
        <p className="mt-0.5 text-sm">It is read on this device and is never uploaded or stored.</p>
      </div>
      <p>
        Only authorised security and reception staff can see your details. They are not shared unless the law
        requires it, and are deleted after {config.retentionMonths} months.
      </p>
      <p>
        You can ask to see, correct or delete your data, or object to its use, by contacting {contact}. If you prefer
        not to consent, please check in at the reception desk.
      </p>
    </div>
  );
}
