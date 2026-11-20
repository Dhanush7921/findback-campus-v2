import { ErrorState, PageHeader, PageSkeleton } from '../../components/ui';
import { BarList, DateFilter, WeeklyBars, sorted, useAnalytics, useRange } from './shared';

export default function Trends() {
  const r = useRange();
  const { data, error, reload } = useAnalytics(r.qs);
  return (
    <>
      <PageHeader title="Analytics & trends" lead="Weekly activity, categories and department-wise recovery." actions={<DateFilter {...r} />} />
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <WeeklyBars title="Complaints submitted" data={data.weeks} k="complaints" />
            <WeeklyBars title="Items found" data={data.weeks} k="found" />
            <WeeklyBars title="Items returned" data={data.weeks} k="returned" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <BarList title="Department analysis (complaints · returned)" rows={Object.entries(data.byDepartment).sort((a, b) => b[1].complaints - a[1].complaints).map(([d, v]) => [d, v.complaints, `${v.returned} returned`])} />
            <BarList title="Lost items by category" rows={sorted(data.byCategory)} />
          </div>
          <BarList title="Found inventory by status" rows={sorted(data.itemsByStatus)} />
        </div>
      )}
    </>
  );
}
