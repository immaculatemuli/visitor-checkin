import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  SVGProps,
  TextareaHTMLAttributes,
} from 'react';
import { IconAlert, IconBack, IconCheck, IconChevron, IconInfo } from './icons';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 disabled:text-slate-400',
  outline: 'bg-white text-slate-900 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400',
  ghost: 'text-brand-600 hover:bg-brand-50 disabled:text-slate-400',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed',
        size === 'sm' && 'h-9 rounded-lg px-3 text-sm',
        size === 'md' && 'h-11 rounded-xl px-4 text-sm',
        size === 'lg' && 'h-14 w-full rounded-2xl px-5 text-base',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex justify-center py-24 text-brand-600">
      <Spinner />
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1.5 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

const inputClass =
  'block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:opacity-60 sm:text-sm';

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} className={cx(inputClass, 'h-12', invalid && 'border-red-400 bg-red-50/40', className)} />;
}

export function Select({ invalid, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select {...props} className={cx(inputClass, 'h-12', invalid && 'border-red-400 bg-red-50/40', className)} />;
}

export function Textarea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} className={cx(inputClass, 'py-3', invalid && 'border-red-400 bg-red-50/40', className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-3xl border border-slate-200/80 bg-white p-5', className)}>{children}</div>;
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONES: Record<Tone, { box: string; icon: ComponentType<SVGProps<SVGSVGElement>> }> = {
  info: { box: 'bg-slate-50 text-slate-700', icon: IconInfo },
  success: { box: 'bg-emerald-50 text-emerald-900', icon: IconCheck },
  warning: { box: 'bg-amber-50 text-amber-900', icon: IconAlert },
  error: { box: 'bg-red-50 text-red-900', icon: IconAlert },
};

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-2xl px-4 py-3.5 text-sm', box)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  CHECKED_IN: 'bg-emerald-50 text-emerald-700 [--dot:var(--color-emerald-500)]',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 [--dot:var(--color-amber-500)]',
  CHECKED_OUT: 'bg-slate-100 text-slate-600 [--dot:var(--color-slate-400)]',
  DENIED: 'bg-red-50 text-red-700 [--dot:var(--color-red-500)]',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', BADGE[status] ?? BADGE.CHECKED_OUT)}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      {label}
    </span>
  );
}

export function Tag({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' }) {
  return (
    <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>
      {children}
    </span>
  );
}

/** A large tappable row: icon, title, subtitle, chevron. */
export function ChoiceButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
  emphasis,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  subtitle?: string;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-4 rounded-3xl border p-4 text-left transition active:scale-[0.99]',
        emphasis ? 'border-brand-200 bg-brand-50/60 hover:bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <span className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', emphasis ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        {subtitle && <span className="mt-0.5 block text-sm text-slate-500">{subtitle}</span>}
      </span>
      <IconChevron className="h-5 w-5 text-slate-300" />
    </button>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src="/nys-emblem.png" alt="National Youth Service" className="h-9 w-auto" />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700">National Youth Service</span>
          <span className="block text-[15px] font-semibold tracking-tight">Visitor Check-in</span>
        </span>
      )}
    </span>
  );
}

/** The green and yellow band from NYS materials, under page headers. */
export function NysStripe({ className = 'h-1' }: { className?: string }) {
  return (
    <div className={cx('flex shrink-0', className)} aria-hidden>
      <div className="flex-[3] bg-brand-600" />
      <div className="flex-1 bg-nys-yellow" />
      <div className="flex-[3] bg-brand-600" />
    </div>
  );
}

/**
 * Layout for the visitor's phone screens: slim header with back button and step progress,
 * content, and an optional action bar pinned to the bottom of the screen.
 */
export function VisitorShell({
  children,
  onBack,
  step,
  footer,
}: {
  children: ReactNode;
  onBack?: () => void;
  step?: { current: number; total: number };
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-4">
          {onBack ? (
            <button onClick={onBack} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Back">
              <IconBack className="h-5 w-5" />
            </button>
          ) : (
            <Logo />
          )}
          {step && <span className="ml-auto text-xs font-medium text-slate-400">Step {step.current} of {step.total}</span>}
        </div>
        {step ? (
          <div className="mx-auto h-1 max-w-md bg-slate-100">
            <div className="h-full bg-brand-600 transition-[width] duration-300" style={{ width: `${(step.current / step.total) * 100}%` }} />
          </div>
        ) : (
          <NysStripe />
        )}
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-6 pt-6">{children}</main>
      {footer && (
        <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        </div>
      )}
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{subtitle}</p>}
    </div>
  );
}
