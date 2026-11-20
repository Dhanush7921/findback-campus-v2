import { Download } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { Button, Card, Input } from '../../components/ui';
import { ApiError, apiDownload } from '../../lib/api';
import { useStaffGet } from '../staff/common';

export interface Analytics {
  range: { from: string; to: string };
  totals: { complaints: number; pending: number; foundItems: number; returned: number; handoversPending: number; disputes: number };
  recoveryRate: number;
  avgDaysToReturn: number | null;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byDepartment: Record<string, { complaints: number; returned: number }>;
  reporterTypes: Record<string, number>;
  hotspots: { location: string; lost: number; found: number }[];
  handoverActivity: { released: number; proxy: number; cancelled: number };
  itemsByStatus: Record<string, number>;
  weeks: { week: string; complaints: number; found: number; returned: number }[];
}

export function useRange() {
  const [range, setRange] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
  return { range, setRange, qs };
}

export function useAnalytics(qs: string) {
  return useStaffGet<Analytics>(`/api/mgmt/analytics${qs ? `?${qs}` : ''}`);
}

export function DateFilter({ range, setRange }: ReturnType<typeof useRange>) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-semibold text-ink-500">From<Input type="date" className="!min-h-0 !py-2" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
      <label className="text-xs font-semibold text-ink-500">To<Input type="date" className="!min-h-0 !py-2" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      {(range.from || range.to) && <Button size="sm" variant="ghost" onClick={() => setRange({ from: '', to: '' })}>Clear</Button>}
    </div>
  );
}

export function ExportButton({ type, qs, label }: { type: 'complaints' | 'handovers' | 'found'; qs: string; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      try { await apiDownload(`/api/mgmt/export?type=${type}${qs ? `&${qs}` : ''}`, 'staff', `findback-${type}.csv`); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
    }}><Download className="h-4 w-4" /> {label ?? `Export ${type}`}</Button>
  );
}

export function Tiles({ items }: { items: [string, string | number, string?][] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, hint]) => (
        <Card key={label} className="relative overflow-hidden p-5">
          <span className="absolute inset-x-0 top-0 h-1 brand-gradient" aria-hidden />
          <p className="font-display text-3xl font-extrabold tabular-nums">{value}</p>
          <p className="text-sm text-ink-500">{label}</p>
          {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        </Card>
      ))}
    </div>
  );
}

/** Horizontal single-hue bars, labelled directly (no legend needed). */
export function BarList({ title, rows, unit = '' }: { title: string; rows: [string, number, string?][]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Card className="p-6">
      <h2 className="mb-4 font-bold">{title}</h2>
      {!rows.length ? <p className="text-sm text-ink-500">No data for this period.</p> : (
        <ul className="space-y-2.5">
          {rows.map(([label, v, extra]) => (
            <li key={label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-ink-700" title={label}>{label}</span>
              <span className="h-3 rounded-r-full bg-teal-500" style={{ width: `${(v / max) * 100}%`, minWidth: v ? 4 : 0 }} />
              <span className="tabular-nums text-ink-700">{v}{unit}{extra ? <span className="text-ink-400"> · {extra}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WeeklyBars({ title, data, k }: { title: string; data: Analytics['weeks']; k: 'complaints' | 'found' | 'returned' }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d[k]));
  const W = 360, H = 140, gap = 2, bw = W / data.length - gap;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between"><h3 className="text-sm font-bold">{title}</h3><span className="text-xs text-ink-500">{hover != null ? `Week of ${data[hover].week}: ${data[hover][k]}` : `12 weeks · max ${max}`}</span></div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`${title} per week`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="#d7e0e0" />
        {data.map((d, i) => {
          const h = (d[k] / max) * (H - 8);
          const x = i * (bw + gap);
          return (
            <g key={d.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              <path d={h > 0 ? `M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z` : ''} fill={hover === i ? '#0f766e' : '#14b8a6'} />
              <title>{`Week of ${d.week}: ${d[k]}`}</title>
              {i % 3 === 0 && <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="#6c8381">{d.week.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

export const sorted = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]) as [string, number][];
