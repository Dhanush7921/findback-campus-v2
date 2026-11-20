import { BadgeCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { StatusBadge } from '../../components/status';
import { useToast } from '../../components/toast';
import { COMPLAINT_FIELDS, EditModal } from '../../components/EditForms';
import { Button, Card, ErrorState, Field, Input, PageHeader, PageSkeleton, Select, Textarea, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet, type R } from './common';
import { StaffImage } from './StaffImage';

interface Detail {
  complaint: R; updates: R[]; claims: R[]; handovers: R[];
  activeMatches: { itemId: string; at: string; item: Record<string, string>; note: string }[];
  suggestions: { item: R; score: number }[];
  reporter: { type: string; uid: string; verifiedPhone: string; name: string; studentId: string; department: string; channel: string };
  allowedTransitions: string[];
}

export function SuggestionList({ d, onPropose, busy }: { d: Detail; onPropose: (itemId: string) => void; busy: string | null }) {
  if (!d.suggestions.length) return <p className="text-sm text-ink-500">No similar items in storage right now.</p>;
  return (
    <ul className="divide-y divide-silver-100">
      {d.suggestions.map(({ item: f, score }) => (
        <li key={f.item_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <Link to={`/staff/inventory/${f.item_id}`} className="font-mono text-teal-700 hover:underline">{f.item_id}</Link> <strong>{f.item_name}</strong>
            <p className="text-xs text-ink-500">{f.color_features} · {f.found_location} · found {fmtDate(f.found_date, false)}</p>
            {f.private_details && <p className="text-xs text-ink-400">Private: {f.private_details}</p>}
          </div>
          <div className="flex items-center gap-3"><span className="chip bg-violet-100 text-violet-800">{score}%</span><Button size="sm" variant="soft" loading={busy === f.item_id} onClick={() => onPropose(f.item_id)}>Propose</Button></div>
        </li>
      ))}
    </ul>
  );
}

export default function ComplaintDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: d, error, reload } = useStaffGet<Detail>(`/api/staff/complaints/${id}`);
  const [status, setStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!d) return <PageSkeleton />;
  const c = d.complaint;
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); await reload(); return true; } catch (e) { toast((e as ApiError).message, 'error'); return false; } finally { setBusy(null); }
  };
  const manual = d.allowedTransitions;
  return (
    <>
      <PageHeader eyebrow={<Link to="/staff/complaints" className="hover:underline">← Complaints</Link>} title={<span className="font-mono">{c.complaint_id}</span>} lead={`${c.item_name} · submitted ${fmtDate(c.created_at)}`} actions={<div className="flex items-center gap-2"><StatusBadge status={c.status} translate={false} />{!['Returned', 'Closed'].includes(c.status) && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit details</Button>}</div>} />
      {editing && <EditModal open title="Edit complaint details" fields={COMPLAINT_FIELDS} reason note="The verified reporter identity cannot be edited. Status changes use the workflow below." initial={{ category: c.category, itemName: c.item_name, description: c.description, colorFeatures: c.color_features, lastSeenLocation: c.last_seen_location, lostDate: c.lost_date, lostTime: c.lost_time }} onClose={() => setEditing(false)} onSave={async (v) => { await apiPost(`/api/staff/complaints/${c.complaint_id}/edit`, v, { auth: 'staff' }); await reload(); }} />}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card className="divide-y divide-silver-100">
            {[['Reporter', `${c.name}${c.student_id ? ` · ${c.student_id}` : ''}${c.department ? ` · ${c.department}` : ''}`], ['Contact', [d.reporter.verifiedPhone || c.phone, c.email].filter(Boolean).join(' · ')], ...(c.visit_info ? [['Visit info', c.visit_info]] : []), ...(c.proxy_name ? [['Authorised collector', `${c.proxy_name} · ${c.proxy_phone}`]] : []), ['Category', c.category], ['Description', c.description], ['Colour & features', c.color_features], ['Last seen', `${c.last_seen_location} · ${fmtDate(c.lost_date, false)} ${c.lost_time}`], ['Ownership evidence (private)', c.ownership_evidence], ['Additional info', c.extra_info || '—'], ['Staff notes', c.staff_notes || '—']].map(([k, v]) => (
              <div key={k} className="grid gap-1 p-4 sm:grid-cols-[190px_1fr]"><dt className="text-sm font-semibold text-ink-500">{k}</dt><dd className="whitespace-pre-line break-words text-sm">{v}</dd></div>
            ))}
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-bold">Suggested matches</h2>
            <SuggestionList d={d} busy={busy} onPropose={(itemId) => act(itemId, () => apiPost(`/api/staff/complaints/${c.complaint_id}/propose-match`, { itemId }, { auth: 'staff' }), 'Match proposed')} />
            {d.activeMatches.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-sm font-bold">Proposed to student</h3>
                <ul className="divide-y divide-silver-100">
                  {d.activeMatches.map((m) => (
                    <li key={m.itemId} className="flex items-center justify-between py-2 text-sm"><span><span className="font-mono">{m.itemId}</span> {m.item.itemName}</span>
                      <Button size="sm" variant="ghost" loading={busy === 'w' + m.itemId} onClick={() => act('w' + m.itemId, () => apiPost(`/api/staff/complaints/${c.complaint_id}/withdraw-match`, { itemId: m.itemId }, { auth: 'staff' }), 'Match withdrawn')}>Withdraw</Button></li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="mb-4 font-bold">History</h2>
            <ol className="space-y-3 border-l-2 border-teal-100 pl-5">
              {d.updates.map((u) => (
                <li key={u.update_id} className="text-sm"><p>{u.message} {u.visible_to_student !== 'true' && <span className="chip ml-1 bg-silver-100 text-ink-500">internal</span>}</p><p className="text-xs text-ink-400">{fmtDate(u.created_at)} · {u.actor}</p></li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          {c.photo_file_id && <Card className="p-3"><StaffImage fileId={c.photo_file_id} alt={c.item_name} className="aspect-square w-full rounded-xl" /></Card>}
          <Card className="space-y-4 p-6">
            <h2 className="font-bold">Update status</h2>
            {manual.length === 0 ? <p className="text-sm text-ink-500">No manual changes available. Claim approval and handover drive the remaining steps.</p> : (
              <>
                <Field label="New status">{(fid) => <Select id={fid} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Choose…</option>{manual.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
                <Field label="Note" optionalLabel="optional">{(fid) => <Input id={fid} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />}</Field>
                <Button disabled={!status} loading={busy === 'status'} onClick={async () => { if (await act('status', () => apiPost(`/api/staff/complaints/${c.complaint_id}/status`, { status, note: statusNote }, { auth: 'staff' }), 'Status updated')) { setStatus(''); setStatusNote(''); } }}>Save status</Button>
              </>
            )}
          </Card>
          <Card className="space-y-3 p-6">
            <h2 className="font-bold">Add note</h2>
            <Textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[80px]" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-teal-600" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to reporter</label>
            <Button variant="secondary" disabled={note.trim().length < 2} loading={busy === 'note'} onClick={async () => { if (await act('note', () => apiPost(`/api/staff/complaints/${c.complaint_id}/note`, { note, visibleToStudent: visible }, { auth: 'staff' }), 'Note added')) setNote(''); }}>Add note</Button>
          </Card>
          <Card className="space-y-2 p-6">
            <h2 className="flex items-center gap-2 font-bold"><BadgeCheck className="h-4 w-4 text-teal-600" /> Submitted by</h2>
            <p className="text-sm"><span className={`chip ${d.reporter.type === 'Student' ? 'bg-emerald-100 text-emerald-800' : d.reporter.type === 'Guest' ? 'bg-sky-100 text-sky-800' : 'bg-zinc-100 text-zinc-700'}`}>{d.reporter.type === 'Student' ? 'College-verified student' : d.reporter.type === 'Guest' ? 'Phone-verified guest' : d.reporter.type}</span></p>
            <p className="text-sm text-ink-700">{d.reporter.name}{d.reporter.studentId ? ` · ${d.reporter.studentId}` : ''}<br />Verified phone: {d.reporter.verifiedPhone || '—'}<br />Channel: {d.reporter.channel || '—'}</p>
            <p className="break-all text-xs text-ink-400">Account: {d.reporter.uid || 'none (V1 record)'}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
