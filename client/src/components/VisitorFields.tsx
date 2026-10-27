import type { DocumentType, VisitCategory } from '../lib/api';
import { Field, Input, Select, Textarea } from './ui';

export interface DocumentValues {
  documentType: DocumentType;
  fullName: string;
  documentNumber: string;
  nationality: string;
  dob: string;
  documentExpiry: string;
}

export interface VisitValues {
  category: VisitCategory;
  phone: string;
  department: string;
  hostName: string;
  purpose: string;
}

export const emptyDocument = (documentType: DocumentType): DocumentValues => ({
  documentType,
  fullName: '',
  documentNumber: '',
  nationality: documentType === 'national_id' ? 'KEN' : '',
  dob: '',
  documentExpiry: '',
});

export const emptyVisit = (category: VisitCategory): VisitValues => ({
  category,
  phone: '',
  department: '',
  hostName: '',
  purpose: '',
});

type Errors = Record<string, string>;

export function DocumentFields({
  value,
  onChange,
  errors,
  showType,
}: {
  value: DocumentValues;
  onChange: (v: DocumentValues) => void;
  errors: Errors;
  showType?: boolean;
}) {
  const set = (patch: Partial<DocumentValues>) => onChange({ ...value, ...patch });
  const isPassport = value.documentType === 'passport';
  return (
    <div className="space-y-4">
      {showType && (
        <Field label="Document">
          <Select value={value.documentType} onChange={(e) => set({ documentType: e.target.value as DocumentType })}>
            <option value="national_id">Kenyan National ID</option>
            <option value="passport">Passport</option>
          </Select>
        </Field>
      )}
      <Field label="Full name" error={errors.fullName}>
        <Input value={value.fullName} onChange={(e) => set({ fullName: e.target.value })} autoComplete="name" invalid={!!errors.fullName} />
      </Field>
      <Field label={isPassport ? 'Passport number' : 'ID number'} error={errors.documentNumber}>
        <Input
          value={value.documentNumber}
          onChange={(e) => set({ documentNumber: e.target.value.toUpperCase() })}
          inputMode={isPassport ? 'text' : 'numeric'}
          autoComplete="off"
          invalid={!!errors.documentNumber}
        />
      </Field>
      {isPassport && (
        <Field label="Nationality" error={errors.nationality} hint="3-letter code, e.g. KEN, UGA, TZA">
          <Input value={value.nationality} maxLength={3} onChange={(e) => set({ nationality: e.target.value.toUpperCase() })} invalid={!!errors.nationality} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth" error={errors.dob}>
          <Input type="date" value={value.dob} onChange={(e) => set({ dob: e.target.value })} invalid={!!errors.dob} />
        </Field>
        {isPassport && (
          <Field label="Expiry date" error={errors.documentExpiry}>
            <Input type="date" value={value.documentExpiry} onChange={(e) => set({ documentExpiry: e.target.value })} invalid={!!errors.documentExpiry} />
          </Field>
        )}
      </div>
    </div>
  );
}

/** Visitors give host + purpose; attachees only the department they're attached to. */
export function VisitFields({
  value,
  onChange,
  errors,
  departments,
  showPhone = true,
}: {
  value: VisitValues;
  onChange: (v: VisitValues) => void;
  errors: Errors;
  departments: string[];
  showPhone?: boolean;
}) {
  const set = (patch: Partial<VisitValues>) => onChange({ ...value, ...patch });
  const isVisitor = value.category === 'visitor';
  return (
    <div className="space-y-4">
      {showPhone && (
        <Field label="Phone number" error={errors.phone} hint="So we can recognise you next time">
          <Input type="tel" value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="0712 345 678" autoComplete="tel" invalid={!!errors.phone} />
        </Field>
      )}
      <Field label={isVisitor ? 'Department you are visiting' : 'Department you are attached to'} error={errors.department}>
        <Select value={value.department} onChange={(e) => set({ department: e.target.value })} invalid={!!errors.department}>
          <option value="">Choose a department</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
      </Field>
      {isVisitor && (
        <>
          <Field label="Person you are visiting" error={errors.hostName}>
            <Input value={value.hostName} onChange={(e) => set({ hostName: e.target.value })} invalid={!!errors.hostName} />
          </Field>
          <Field label="Purpose of visit" error={errors.purpose}>
            <Textarea rows={2} value={value.purpose} onChange={(e) => set({ purpose: e.target.value })} invalid={!!errors.purpose} />
          </Field>
        </>
      )}
    </div>
  );
}

/** Drops empty optional fields so the API's optional() validators don't see "". */
export function documentPayload(v: DocumentValues) {
  return {
    documentType: v.documentType,
    fullName: v.fullName.trim(),
    documentNumber: v.documentNumber.trim(),
    nationality: v.nationality.trim() || undefined,
    dob: v.dob || undefined,
    documentExpiry: v.documentType === 'passport' ? v.documentExpiry || undefined : undefined,
  };
}

export function visitPayload(v: VisitValues, includePhone = true) {
  return {
    category: v.category,
    department: v.department,
    ...(includePhone ? { phone: v.phone } : {}),
    ...(v.category === 'visitor' ? { hostName: v.hostName.trim(), purpose: v.purpose.trim() } : {}),
  };
}

/** Required-field check before calling the API, so every missing field shows at once. */
export function missingFields(doc: DocumentValues | null, visit: VisitValues, includePhone = true): Errors {
  const e: Errors = {};
  if (doc) {
    if (!doc.fullName.trim()) e.fullName = 'Enter your full name';
    if (!doc.documentNumber.trim()) e.documentNumber = doc.documentType === 'passport' ? 'Enter your passport number' : 'Enter your ID number';
    if (doc.documentType === 'passport' && !doc.documentExpiry) e.documentExpiry = 'Enter the expiry date';
    if (doc.documentType === 'passport' && !doc.nationality.trim()) e.nationality = 'Enter your nationality';
  }
  if (includePhone && !visit.phone.trim()) e.phone = 'Enter your phone number';
  if (!visit.department) e.department = 'Choose a department';
  if (visit.category === 'visitor') {
    if (!visit.hostName.trim()) e.hostName = 'Enter the name of the person you are visiting';
    if (!visit.purpose.trim()) e.purpose = 'Briefly describe the purpose of your visit';
  }
  return e;
}
