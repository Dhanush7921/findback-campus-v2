import { ErrorState, PageHeader, PageSkeleton } from '../../components/ui';
import { BarList, DateFilter, ExportButton, Tiles, sorted, useAnalytics, useRange } from './shared';

export default function Overview() {
  const r = useRange();
  const { data, error, reload } = useAnalytics(r.qs);
  return (
    <>
      <PageHeader eyebrow="Management · read-only" title="Executive overview" lead="Campus-wide lost & found performance. Figures come directly from the operational records." actions={<DateFilter {...r} />} />
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
        <div className="space-y-6">
          <Tiles items={[
            ['Total complaints', data.totals.complaints],
            ['Pending', data.totals.pending],
            ['Found items registered', data.totals.foundItems],
            ['Returned', data.totals.returned],
            ['Recovery rate', `${data.recoveryRate}%`],
            ['Avg. days to return', data.avgDaysToReturn ?? '—'],
          ]} />
          <div className="grid gap-6 lg:grid-cols-2">
            <BarList title="Complaints by status" rows={sorted(data.byStatus)} />
            <div className="space-y-6">
              <BarList title="Student vs guest reporting" rows={sorted(data.reporterTypes)} />
              <BarList title="Handover activity" rows={[['Released (receiver-confirmed)', data.handoverActivity.released], ['…of which by authorised proxy', data.handoverActivity.proxy], ['Awaiting confirmation / release', data.totals.handoversPending], ['Cancelled or expired attempts', data.handoverActivity.cancelled], ['Claim disputes', data.totals.disputes]]} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButton type="complaints" qs={r.qs} />
            <ExportButton type="handovers" qs={r.qs} />
            <ExportButton type="found" qs={r.qs} label="Export found items" />
          </div>
        </div>
      )}
    </>
  );
}
