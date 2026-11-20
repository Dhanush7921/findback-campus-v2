import { useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/status';
import { useToast } from '../../components/toast';
import { Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, Spinner, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet, type R } from './common';
import { SuggestionList } from './ComplaintDetail';

export default function Matching() {
  const toast = useToast();
  const [status, setStatus] = useState('Submitted');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useStaffGet<{ rows: R[] }>(`/api/staff/complaints?status=${encodeURIComponent(status)}`);
  const detail = useStaffGet<Parameters<typeof SuggestionList>[0]['d']>(selected ? `/api/staff/complaints/${selected}` : null);
  return (
    <>
      <PageHeader title="Item matching & review" lead="Pick an open complaint to see found items ranked by similarity (category, keywords, colour, place and date). You decide what is proposed." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-silver-100 p-3">
            <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setSelected(null); }}>
              <option>Submitted</option><option>Under Review</option><option>Potential Match</option>
            </Select>
          </div>
          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <div className="space-y-2 p-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div> : !list.data.rows.length ? <EmptyState title="No complaints in this status" /> : (
            <ul className="max-h-[70vh] divide-y divide-silver-100 overflow-auto">
              {list.data.rows.map((c) => (
                <li key={c.complaint_id}>
                  <button className={`w-full p-4 text-left transition ${selected === c.complaint_id ? 'bg-teal-50' : 'hover:bg-silver-50'}`} onClick={() => setSelected(c.complaint_id)}>
                    <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold text-teal-700">{c.complaint_id}</span><StatusBadge status={c.status} translate={false} /></div>
                    <p className="mt-1 text-sm font-medium">{c.item_name}</p>
                    <p className="text-xs text-ink-500">{c.category} · {c.last_seen_location} · {fmtDate(c.lost_date, false)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          {!selected ? <EmptyState title="Select a complaint" text="Suggestions appear here." /> : detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : !detail.data ? <Spinner /> : (
            <>
              <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{detail.data.complaint.item_name}</h2><Link className="text-sm font-semibold text-teal-700 hover:underline" to={`/staff/complaints/${selected}`}>Open complaint →</Link></div>
              <p className="mb-4 text-sm text-ink-500">{detail.data.complaint.description} · {detail.data.complaint.color_features}</p>
              <SuggestionList d={detail.data} busy={busy} onPropose={async (itemId) => {
                setBusy(itemId);
                try { await apiPost(`/api/staff/complaints/${selected}/propose-match`, { itemId }, { auth: 'staff' }); toast('Match proposed to student'); await Promise.all([detail.reload(), list.reload()]); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
              }} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
