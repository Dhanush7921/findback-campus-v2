import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { StatusBadge } from '../../components/status';
import { useToast } from '../../components/toast';
import { Button, Card, ErrorState, Field, Input, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet, type R } from './common';
import { StaffImage } from './StaffImage';

export default function ItemDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ item: R; claims: R[]; suggestions: { complaint: R; score: number }[] }>(`/api/staff/found-items/${id}`);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const i = data.item;
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const photos = i.photo_file_ids ? i.photo_file_ids.split(',').filter(Boolean) : [];
  return (
    <>
      <PageHeader eyebrow={<Link to="/staff/inventory" className="hover:underline">← Inventory</Link>} title={i.item_name} lead={<span className="font-mono">{i.item_id}</span>} actions={<StatusBadge status={i.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card className="divide-y divide-silver-100">
            {[['Category', i.category], ['Public description', i.public_description], ['Private details (staff only)', i.private_details || '—'], ['Colour & features', i.color_features], ['Found', `${fmtDate(i.found_date, false)} at ${i.found_location}`], ['Storage', i.storage_location], ['Registered by', `${i.registered_by} · ${fmtDate(i.created_at)}`], ['Matched complaint', i.matched_complaint_id || '—']].map(([k, v]) => (
              <div key={k} className="grid gap-1 p-4 sm:grid-cols-[200px_1fr]"><dt className="text-sm font-semibold text-ink-500">{k}</dt><dd className="whitespace-pre-line text-sm">{k === 'Matched complaint' && v !== '—' ? <Link className="font-mono text-teal-700 hover:underline" to={`/staff/complaints/${v}`}>{v}</Link> : v}</dd></div>
            ))}
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-bold">Possible owners</h2>
            {!data.suggestions.length ? <p className="text-sm text-ink-500">No open complaints look similar yet.</p> : (
              <ul className="divide-y divide-silver-100">
                {data.suggestions.map(({ complaint: c, score }) => (
                  <li key={c.complaint_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div><Link to={`/staff/complaints/${c.complaint_id}`} className="font-mono text-teal-700 hover:underline">{c.complaint_id}</Link> <span className="text-ink-700">{c.item_name}</span><p className="text-xs text-ink-500">{c.color_features} · {c.last_seen_location} · lost {fmtDate(c.lost_date, false)}</p></div>
                    <div className="flex items-center gap-3"><span className="chip bg-violet-100 text-violet-800">{score}% match</span>
                      <Button size="sm" variant="soft" loading={busy === c.complaint_id} disabled={!['In Storage', 'Matched'].includes(i.status)} onClick={() => act(c.complaint_id, () => apiPost(`/api/staff/complaints/${c.complaint_id}/propose-match`, { itemId: i.item_id }, { auth: 'staff' }), 'Match proposed to student')}>Propose match</Button></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          {photos.length > 0 && <Card className="grid grid-cols-2 gap-2 p-3">{photos.map((p) => <StaffImage key={p} fileId={p} alt={i.item_name} className="aspect-square w-full rounded-xl" />)}</Card>}
          <Card className="space-y-4 p-6">
            <h2 className="font-bold">Change status</h2>
            <Field label="New status">{(fid) => <Select id={fid} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Choose…</option><option>In Storage</option><option>Donated</option><option>Disposed</option></Select>}</Field>
            <Field label="Note" hint="Required for donation/disposal.">{(fid) => <Input id={fid} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button disabled={!status} loading={busy === 'status'} onClick={() => act('status', () => apiPost(`/api/staff/found-items/${i.item_id}/status`, { status, note }, { auth: 'staff' }), 'Status updated')}>Update</Button>
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-bold">Claims on this item</h2>
            {data.claims.length ? data.claims.map((c) => <div key={c.claim_id} className="flex justify-between py-1 text-sm"><span className="font-mono">{c.claim_id}</span><StatusBadge status={c.status} /></div>) : <p className="text-sm text-ink-500">None.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
