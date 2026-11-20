import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
const variants: Record<Variant, string> = {
  primary: 'brand-gradient text-white shadow-[var(--shadow-lift)] hover:brightness-[1.06] active:brightness-95',
  secondary: 'bg-white text-ink-900 border border-silver-200 shadow-sm hover:border-teal-300 hover:bg-teal-50/40',
  ghost: 'text-ink-700 hover:bg-silver-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  soft: 'bg-teal-50 text-teal-800 hover:bg-teal-100',
};
const sizes = { sm: 'h-9 px-3 text-sm rounded-lg', md: 'h-12 px-5 text-[15px] rounded-xl', lg: 'h-14 px-7 text-base rounded-2xl' };
const base = 'inline-flex items-center justify-center gap-2 font-semibold transition duration-200 select-none disabled:opacity-55 disabled:pointer-events-none whitespace-nowrap';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean }>(
  ({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...p }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function ButtonLink({ variant = 'primary', size = 'md', className = '', ...p }: LinkProps & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...p} />;
}

interface FieldProps { label: ReactNode; error?: string; hint?: ReactNode; required?: boolean; optionalLabel?: string; children: (id: string, describedBy: string | undefined) => ReactNode; className?: string }
export function Field({ label, error, hint, required, optionalLabel, children, className = '' }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label} {required ? <span className="text-rose-600" aria-hidden>*</span> : optionalLabel ? <span className="font-normal text-ink-400">({optionalLabel})</span> : null}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-ink-500">{hint}</p>}
      {error && (
        <p id={errId} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-600 animate-fade">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ invalid, className = '', ...p }, ref) => (
  <input ref={ref} className={`input ${className}`} aria-invalid={invalid || undefined} {...p} />
));
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ invalid, className = '', ...p }, ref) => (
  <textarea ref={ref} className={`input min-h-[110px] resize-y leading-relaxed ${className}`} aria-invalid={invalid || undefined} {...p} />
));
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(({ invalid, className = '', ...p }, ref) => (
  <select ref={ref} className={`input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22 fill=%22none%22 stroke=%22%234f6866%22 stroke-width=%222%22><path d=%22m6 8 4 4 4-4%22/></svg>')] bg-[length:20px] bg-[right_0.75rem_center] bg-no-repeat pr-10 ${className}`} aria-invalid={invalid || undefined} {...p} />
));
Select.displayName = 'Select';

export function Card({ className = '', children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...p}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-ink-500">
      <span className="relative flex h-12 w-12">
        <span className="absolute inset-0 rounded-full border-4 border-teal-100" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-teal-600" />
      </span>
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-10" aria-busy>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid gap-4 pt-4 sm:grid-cols-3">
        <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function Notice({ tone = 'info', title, children, className = '' }: { tone?: 'info' | 'success' | 'warn' | 'error'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: ['bg-sky-50 border-sky-200 text-sky-900', Info],
    success: ['bg-emerald-50 border-emerald-200 text-emerald-900', CheckCircle2],
    warn: ['bg-amber-50 border-amber-200 text-amber-900', AlertTriangle],
    error: ['bg-rose-50 border-rose-200 text-rose-900', AlertTriangle],
  } as const;
  const [cls, Icon] = styles[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-2xl border p-4 text-sm ${cls} ${className}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1">{title && <p className="font-semibold">{title}</p>}{children && <div className="leading-relaxed opacity-90">{children}</div>}</div>
    </div>
  );
}

export function EmptyState({ art, title, text, action }: { art?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-rise">
      {art && <div className="mb-5 w-40 text-teal-600">{art}</div>}
      <h3 className="text-lg font-bold">{title}</h3>
      {text && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-rise" role="alert">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600"><AlertTriangle className="h-7 w-7" aria-hidden /></div>
      <p className="max-w-md text-sm text-ink-700">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Try again</Button>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, lead, actions }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-teal-700">{eyebrow}</p>}
        <h1 className="text-[1.75rem] font-extrabold leading-tight sm:text-4xl">{title}</h1>
        {lead && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-500">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-0 backdrop-blur-sm sm:items-center sm:p-6 animate-fade" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="card max-h-[90dvh] w-full max-w-lg overflow-auto rounded-b-none p-6 sm:rounded-b-[var(--radius-xl2)] animate-rise safe-bottom" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function fmtDate(iso?: string, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
