import { MapPin } from 'lucide-react';
import { Card, ErrorState, PageHeader, PageSkeleton } from '../../components/ui';
import { DateFilter, useAnalytics, useRange } from './shared';

export default function Hotspots() {
  const r = useRange();
  const { data, error, reload } = useAnalytics(r.qs);
  const max = Math.max(1, ...(data?.hotspots ?? []).map((h) => h.lost + h.found));
  return (
    <>
      <PageHeader title="Campus hotspots" lead="Where items are most often lost (last-seen location) and found. Use it to place notices, CCTV coverage or drop boxes." actions={<DateFilter {...r} />} />
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : !data.hotspots.length ? <Card className="p-8 text-center text-sm text-ink-500">No location data for this period.</Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.hotspots.map((h, i) => {
            const heat = (h.lost + h.found) / max;
            return (
              <Card key={h.location} className="p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: `rgb(13 148 136 / ${0.35 + heat * 0.65})` }}><MapPin className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink-400">#{i + 1}</p>
                    <p className="truncate font-semibold capitalize" title={h.location}>{h.location || 'Unspecified'}</p>
                    <p className="text-sm text-ink-500"><strong className="text-ink-900">{h.lost}</strong> lost · <strong className="text-ink-900">{h.found}</strong> found</p>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-silver-100"><div className="h-2 rounded-full bg-teal-500" style={{ width: `${heat * 100}%` }} /></div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
