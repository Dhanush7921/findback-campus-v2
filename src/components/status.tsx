import { Check } from 'lucide-react';
import { COMPLAINT_STATUSES, MAIN_STATUSES, normalizeStatus } from '../../shared/domain';
import { useI18n, type I18nKey } from '../lib/i18n';

const tone: Record<string, string> = {
  Submitted: 'bg-slate-100 text-slate-700',
  'Under Review': 'bg-sky-100 text-sky-800',
  'Potential Match': 'bg-violet-100 text-violet-800',
  'Ownership Verification': 'bg-amber-100 text-amber-900',
  'Awaiting Receiver Confirmation': 'bg-cyan-100 text-cyan-900',
  Cancelled: 'bg-zinc-100 text-zinc-600',
  Disputed: 'bg-orange-100 text-orange-900',
  Unclaimed: 'bg-stone-100 text-stone-700',
  'Pending Acknowledgment': 'bg-cyan-100 text-cyan-900',
  Acknowledged: 'bg-sky-100 text-sky-800',
  Delivered: 'bg-indigo-100 text-indigo-800',
  Released: 'bg-teal-100 text-teal-800',
  Expired: 'bg-zinc-100 text-zinc-600',
  'Ready for Collection': 'bg-emerald-100 text-emerald-800',
  Returned: 'bg-teal-100 text-teal-800',
  Closed: 'bg-zinc-100 text-zinc-600',
  'In Storage': 'bg-sky-100 text-sky-800',
  Matched: 'bg-violet-100 text-violet-800',
  Claimed: 'bg-amber-100 text-amber-900',
  Donated: 'bg-zinc-100 text-zinc-600',
  Disposed: 'bg-zinc-100 text-zinc-600',
  Pending: 'bg-amber-100 text-amber-900',
  Approved: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-rose-100 text-rose-800',
  Completed: 'bg-teal-100 text-teal-800',
};

export function StatusBadge({ status: raw, translate = true }: { status: string; translate?: boolean }) {
  const { t } = useI18n();
  const status = normalizeStatus(raw);
  const label = translate && (COMPLAINT_STATUSES as readonly string[]).includes(status) ? t(`status.${status}` as I18nKey) : status;
  return (
    <span className={`chip ${tone[status] ?? 'bg-silver-100 text-ink-700'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

/** Progress stepper across the main lifecycle (Closed shown separately). */
export function StatusStepper({ status: raw }: { status: string }) {
  const { t } = useI18n();
  const status = normalizeStatus(raw);
  const steps = MAIN_STATUSES.filter((s) => s !== 'Closed');
  const idx = steps.indexOf(status as (typeof steps)[number]);
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label="Progress">
      {steps.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const current = i === idx;
        return (
          <li key={s} className="flex flex-col items-center gap-2 text-center" aria-current={current ? 'step' : undefined}>
            <span className="flex w-full items-center">
              <span className={`h-1 flex-1 rounded-full ${i === 0 ? 'opacity-0' : done || current ? 'bg-teal-500' : 'bg-silver-200'}`} />
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition ${done ? 'bg-teal-600 text-white' : current ? 'brand-gradient text-white ring-4 ring-teal-100' : 'bg-silver-100 text-ink-400'}`}>
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`h-1 flex-1 rounded-full ${i === steps.length - 1 ? 'opacity-0' : done ? 'bg-teal-500' : 'bg-silver-200'}`} />
            </span>
            <span className={`hidden text-[11px] leading-tight sm:block ${current ? 'font-semibold text-ink-900' : 'text-ink-500'}`}>{t(`status.${s}` as I18nKey)}</span>
          </li>
        );
      })}
    </ol>
  );
}
