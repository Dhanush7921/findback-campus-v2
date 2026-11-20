import { Bell, ChevronRight, Handshake, PackageSearch, Send } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyArt } from './art';
import { StatusBadge } from '../../components/status';
import { ButtonLink, Card, EmptyState, ErrorState, Notice, Skeleton, fmtDate } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { useMe, useMeGet } from './common';

interface Row { complaintId: string; createdAt: string; updatedAt: string; status: string; category: string; itemName: string; lastSeenLocation: string }

export default function Dashboard() {
  const { t } = useI18n();
  const { profile } = useMe();
  const list = useMeGet<{ rows: Row[] }>('/api/me/complaints');
  const notes = useMeGet<{ rows: { id: string; complaintId: string; message: string; at: string }[] }>('/api/me/notifications');
  const pending = useMeGet<{ rows: { handoverId: string; complaintId: string }[] }>('/api/me/handovers');
  return (
    <div className="space-y-6">
      <div className="animate-rise">
        <h1 className="text-3xl font-extrabold">{t('me.hello')}{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
        {profile.department && <p className="mt-1 text-sm text-ink-500">{profile.department}</p>}
      </div>
      {!!pending.data?.rows.length && (
        <Notice tone="success" title={t('me.pendingHandover')}>
          <p>{t('me.pendingHandoverText')}</p>
          <ButtonLink to="/me/acknowledge" size="sm" className="mt-3"><Handshake className="h-4 w-4" /> {t('me.confirmNow')}</ButtonLink>
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/me/report" className="card group flex items-center gap-4 p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl brand-gradient text-white"><Send className="h-7 w-7" aria-hidden /></span>
          <span className="flex-1"><span className="block font-display text-lg font-extrabold uppercase tracking-wide">{t('me.submit')}</span><span className="text-sm text-ink-500">{t('me.submitD')}</span></span>
          <ChevronRight className="h-5 w-5 text-ink-400 transition group-hover:translate-x-0.5" />
        </Link>
        <a href="#my-complaints" className="card group flex items-center gap-4 p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white"><PackageSearch className="h-7 w-7" aria-hidden /></span>
          <span className="flex-1"><span className="block font-display text-lg font-extrabold uppercase tracking-wide">{t('me.track')}</span><span className="text-sm text-ink-500">{t('me.trackD')}</span></span>
          <ChevronRight className="h-5 w-5 text-ink-400 transition group-hover:translate-x-0.5" />
        </a>
      </div>

      <Card id="my-complaints" className="overflow-hidden scroll-mt-24">
        <h2 className="p-5 pb-3 text-lg font-bold">{t('me.myComplaints')}</h2>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <div className="space-y-2 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : !list.data.rows.length ? (
          <EmptyState art={<EmptyArt />} title={t('me.none')} text={t('me.noneText')} action={<ButtonLink to="/me/report">{t('me.submit')}</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-silver-100">
            {list.data.rows.map((c) => (
              <li key={c.complaintId}>
                <Link to={`/me/complaints/${c.complaintId}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-silver-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.itemName}</p>
                    <p className="truncate text-xs text-ink-500"><span className="font-mono">{c.complaintId}</span> · {c.category} · {fmtDate(c.createdAt, false)}</p>
                  </div>
                  <StatusBadge status={c.status} />
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Bell className="h-5 w-5 text-teal-600" /> {t('me.notifications')}</h2>
        {!notes.data?.rows.length ? <p className="text-sm text-ink-500">{t('me.noNotifications')}</p> : (
          <ul className="space-y-3">
            {notes.data.rows.slice(0, 10).map((n) => (
              <li key={n.id} className="rounded-xl bg-silver-50 p-3 text-sm">
                <p className="text-ink-700">{n.message}</p>
                <p className="mt-1 text-xs text-ink-400"><Link className="font-mono text-teal-700 hover:underline" to={`/me/complaints/${n.complaintId}`}>{n.complaintId}</Link> · {fmtDate(n.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
