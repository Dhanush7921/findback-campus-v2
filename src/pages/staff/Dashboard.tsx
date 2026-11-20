import { Archive, ClipboardCheck, Inbox, PackagePlus, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { COMPLAINT_STATUSES } from '../../../shared/domain';
import { StatusBadge } from '../../components/status';
import { ButtonLink, Card, ErrorState, PageHeader, PageSkeleton, fmtDate } from '../../components/ui';
import { useStaffGet, type R } from './common';

interface Dash { totals: { complaints: number; foundItems: number; pendingClaims: number }; byStatus: Record<string, number>; itemsByStatus: Record<string, number>; recentComplaints: R[]; recentItems: R[]; pendingClaims: { claimId: string; complaintId: string; itemId: string; createdAt: string }[]; recentActivity: R[] }

export default function Dashboard() {
  const { data, error, reload } = useStaffGet<Dash>('/api/staff/dashboard');
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const open = (data.byStatus['Submitted'] ?? 0) + (data.byStatus['Under Review'] ?? 0) + (data.byStatus['Potential Match'] ?? 0) + (data.byStatus['Ownership Verification'] ?? 0) + (data.byStatus['Disputed'] ?? 0);
  const tiles = [
    ['Open complaints', open, Inbox, '/staff/complaints'],
    ['Items in storage', data.itemsByStatus['In Storage'] ?? 0, Archive, '/staff/inventory'],
    ['Pending claims', data.totals.pendingClaims, ClipboardCheck, '/staff/claims'],
    ['Ready for collection', data.byStatus['Ready for Collection'] ?? 0, Sparkles, '/staff/handovers'],
  ] as const;
  const max = Math.max(1, ...Object.values(data.byStatus));
  return (
    <>
      <PageHeader title="Dashboard" lead="Today’s lost & found workload at a glance." actions={<ButtonLink to="/staff/register"><PackagePlus className="h-4 w-4" /> Register found item</ButtonLink>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value, Icon, to]) => (
          <Link key={label} to={to} className="card p-5 transition hover:shadow-[var(--shadow-lift)]">
            <Icon className="h-5 w-5 text-teal-600" />
            <p className="mt-3 font-display text-3xl font-extrabold">{value}</p>
            <p className="text-sm text-ink-500">{label}</p>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-bold">Complaints by status <span className="font-normal text-ink-400">({data.totals.complaints} total)</span></h2>
          <ul className="space-y-3">
            {COMPLAINT_STATUSES.map((s) => (
              <li key={s} className="grid grid-cols-[170px_1fr_40px] items-center gap-3 text-sm">
                <StatusBadge status={s} translate={false} />
                <span className="h-2.5 overflow-hidden rounded-full bg-silver-100"><span className="block h-full rounded-full bg-teal-500" style={{ width: `${((data.byStatus[s] ?? 0) / max) * 100}%` }} /></span>
                <span className="text-right font-semibold tabular-nums">{data.byStatus[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 font-bold">Pending claim reviews</h2>
          {data.pendingClaims.length === 0 ? <p className="text-sm text-ink-500">No claims waiting.</p> : (
            <ul className="divide-y divide-silver-100">
              {data.pendingClaims.map((c) => (
                <li key={c.claimId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-mono">{c.complaintId} → {c.itemId}</span>
                  <Link to="/staff/claims" className="font-semibold text-teal-700 hover:underline">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 font-bold">Latest complaints</h2>
          <ul className="divide-y divide-silver-100">
            {data.recentComplaints.map((c) => (
              <li key={c.complaint_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link to={`/staff/complaints/${c.complaint_id}`} className="min-w-0"><span className="font-mono text-teal-700">{c.complaint_id}</span> <span className="truncate text-ink-600">{c.item_name}</span></Link>
                <StatusBadge status={c.status} translate={false} />
              </li>
            ))}
            {!data.recentComplaints.length && <li className="py-2 text-sm text-ink-500">No complaints yet.</li>}
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 font-bold">Recent activity</h2>
          <ul className="space-y-2.5 text-sm">
            {data.recentActivity.map((a) => (
              <li key={a.log_id} className="flex justify-between gap-3"><span><strong className="font-semibold">{a.action.replace(/_/g, ' ')}</strong> <span className="text-ink-500">{a.entity_id}</span></span><span className="shrink-0 text-xs text-ink-400">{fmtDate(a.created_at)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
