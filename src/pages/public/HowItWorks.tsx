import { BadgeCheck, ClipboardList, KeyRound, PackageCheck, Search, ShieldCheck } from 'lucide-react';
import { COMPLAINT_STATUSES } from '../../../shared/domain';
import { StatusBadge } from '../../components/status';
import { ButtonLink, Card, PageHeader } from '../../components/ui';
import { useI18n, type I18nKey } from '../../lib/i18n';

export default function HowItWorks() {
  const { t } = useI18n();
  const icons = [ClipboardList, KeyRound, Search, BadgeCheck, ShieldCheck, PackageCheck];
  return (
    <div className="safe-x mx-auto max-w-5xl py-10 sm:py-14">
      <PageHeader eyebrow="FindBack" title={t('how.title')} lead={t('how.lead')} />
      <ol className="relative grid gap-4 sm:grid-cols-2">
        {icons.map((Icon, i) => (
          <li key={i} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
            <Card className="flex h-full gap-4 p-6">
              <div className="relative">
                <div className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-white shadow-[var(--shadow-lift)]"><Icon className="h-6 w-6" aria-hidden /></div>
                <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-teal-700 ring-1 ring-teal-200">{i + 1}</span>
              </div>
              <div>
                <h2 className="font-bold">{t(`how.s${i + 1}t` as I18nKey)}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">{t(`how.s${i + 1}d` as I18nKey)}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <h2 className="mb-4 mt-14 text-2xl font-extrabold">{t('how.statusTitle')}</h2>
      <Card className="divide-y divide-silver-100">
        {COMPLAINT_STATUSES.map((s) => (
          <div key={s} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="w-52 shrink-0"><StatusBadge status={s} /></div>
            <p className="text-sm text-ink-600">{t(`statusDesc.${s}` as I18nKey)}</p>
          </div>
        ))}
      </Card>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <ButtonLink to="/student">{t('v2.studentT')}</ButtonLink>
        <ButtonLink to="/guest" variant="secondary">{t('v2.guestT')}</ButtonLink>
      </div>
    </div>
  );
}
