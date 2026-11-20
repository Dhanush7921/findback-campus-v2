import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/status';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, Notice, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { StaffImage } from './StaffImage';
import { Table, useStaffGet, type R } from './common';

type Ready = R & { complaint: R | null };
const ID_TYPES = ['College ID card', 'Aadhaar', 'Driving licence', 'Passport', 'Voter ID', 'Other government ID'];

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return <span className={s < 60 ? 'text-rose-600' : ''}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

export default function Handovers() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ ready: Ready[]; recent: R[] }>('/api/staff/handovers');
  const [active, setActive] = useState<Ready | null>(null);
  const [form, setForm] = useState({ receiverType: 'owner', receiverName: '', receiverIdType: 'College ID card', receiverIdLast4: '', notes: '', checked: false });
  const [issued, setIssued] = useState<{ handoverId: string; code: string; expiresAt: string; receiverPhone: string } | null>(null);
  const [release, setRelease] = useState<R | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!issued) return; const id = setInterval(reload, 8000); return () => clearInterval(id); }, [issued, reload]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const issuedRow = issued ? data.recent.find((h) => h.handoverId === issued.handoverId) : null;
  const call = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); } };
  const start = () => call(async () => {
    const r = await apiPost<{ handoverId: string; code: string; expiresAt: string; receiverPhone: string }>('/api/staff/handovers', { claimId: active!.claim_id, receiverType: form.receiverType, receiverName: form.receiverName, receiverIdType: form.receiverIdType, receiverIdLast4: form.receiverIdLast4, notes: form.notes }, { auth: 'staff' });
    setIssued(r);
  });
  const awaiting = data.recent.filter((h) => h.status === 'Pending Acknowledgment' || h.status === 'Acknowledged');
  return (
    <>
      <PageHeader title="Receiver-confirmed handover" lead="1) Check the receiver’s photo ID. 2) Issue a one-time code. 3) The receiver enters it on their own verified phone and acknowledges receipt. 4) You confirm physical release." />
      <Card className="mb-6 overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Approved — ready for collection</h2>
        {!data.ready.length ? <EmptyState title="Nothing waiting for collection" /> : (
          <Table head={['Claim', 'Owner', 'Item', 'Approved by', '']}>
            {data.ready.map((c) => (
              <tr key={c.claim_id}>
                <td className="px-4 py-3 font-mono text-xs">{c.claim_id}<br /><Link className="text-teal-700 hover:underline" to={`/staff/complaints/${c.complaint_id}`}>{c.complaint_id}</Link></td>
                <td className="px-4 py-3">{c.complaint?.name}<span className="block text-xs text-ink-500">{c.complaint?.reporter_type || 'Legacy'}{c.complaint?.student_id ? ` · ${c.complaint.student_id}` : ''} · {c.complaint?.verified_phone}</span>{c.complaint?.proxy_name && <span className="chip mt-1 bg-amber-100 text-amber-900">Proxy: {c.complaint.proxy_name} {c.complaint.proxy_phone}</span>}</td>
                <td className="px-4 py-3">{c.complaint?.item_name}<br /><Link className="font-mono text-xs text-teal-700 hover:underline" to={`/staff/inventory/${c.item_id}`}>{c.item_id}</Link></td>
                <td className="px-4 py-3 text-xs">{c.reviewed_by}<br />{fmtDate(c.reviewed_at)}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => { setActive(c); setIssued(null); setForm({ receiverType: 'owner', receiverName: c.complaint?.name ?? '', receiverIdType: 'College ID card', receiverIdLast4: '', notes: '', checked: false }); }}>Start handover</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {!!awaiting.length && (
        <Card className="mb-6 overflow-hidden">
          <h2 className="p-5 pb-0 font-bold">In progress</h2>
          <Table head={['Handover', 'Receiver', 'Status', 'Code expires / confirmed', '']}>
            {awaiting.map((h) => (
              <tr key={h.handoverId}>
                <td className="px-4 py-3 font-mono text-xs">{h.handoverId}<br />{h.complaintId}</td>
                <td className="px-4 py-3">{h.receiverName}<span className="block text-xs text-ink-500">{h.receiverType} · {h.receiverIdType} …{h.receiverIdLast4} · {h.receiverPhone}</span></td>
                <td className="px-4 py-3"><StatusBadge status={h.status} translate={false} /></td>
                <td className="px-4 py-3 text-xs">{h.status === 'Acknowledged' ? fmtDate(h.acknowledgedAt) : <Countdown until={h.challengeExpiresAt} />}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                  {h.status === 'Acknowledged' && <Button size="sm" onClick={() => { setRelease(h); setConfirmRelease(false); }}>Confirm release</Button>}
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => { const reason = window.prompt('Reason for cancelling this handover?'); if (reason) void call(async () => { await apiPost(`/api/staff/handovers/${h.handoverId}/cancel`, { reason }, { auth: 'staff' }); toast('Handover cancelled'); }); }}>Cancel</Button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Completed handovers</h2>
        <Table head={['Receipt', 'Complaint / item', 'Receiver', 'Approved / released by', 'Released']} empty={!data.recent.some((h) => h.status === 'Released')}>
          {data.recent.filter((h) => h.status === 'Released').map((h) => (
            <tr key={h.handoverId}>
              <td className="px-4 py-3 font-mono text-xs">{h.handoverId}</td>
              <td className="px-4 py-3 font-mono text-xs">{h.complaintId}<br />{h.itemId}</td>
              <td className="px-4 py-3">{h.receiverName}<span className="block text-xs text-ink-500">{h.receiverType}{h.signatureName ? ` · signed “${h.signatureName}”` : ''}</span></td>
              <td className="px-4 py-3 text-xs">{h.approvedBy}<br />{h.releasedBy}</td>
              <td className="px-4 py-3 text-xs">{fmtDate(h.releasedAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={!!active} onClose={() => { setActive(null); setIssued(null); }} title={issued ? 'Show this code to the receiver' : 'Start handover'}>
        {issued ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-ink-600">The receiver must open FindBack on the phone ending <strong>{issued.receiverPhone.slice(-4)}</strong>, sign in with OTP, choose <em>Confirm receipt</em> and enter:</p>
            <p className="rounded-2xl bg-gradient-to-br from-emerald-50 to-cyan-50 p-5 font-mono text-5xl font-extrabold tracking-[0.3em] text-teal-900 select-none">{issued.code}</p>
            <p className="text-xs text-ink-500">Expires in <Countdown until={issued.expiresAt} /> · single use · never stored in readable form</p>
            {issuedRow?.status === 'Acknowledged' ? <Notice tone="success" title="Receipt confirmed by receiver">Close this window and confirm release.</Notice> : <p className="text-xs text-ink-400">Waiting for the receiver… this updates automatically.</p>}
            <Button variant="secondary" className="w-full" onClick={() => { setActive(null); setIssued(null); }}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Notice tone="warn">Check a photo ID in person. Record only the ID type and last 4 characters — never the full number.</Notice>
            <Field label="Who is collecting?">{(fid) => <Select id={fid} value={form.receiverType} onChange={(e) => setForm({ ...form, receiverType: e.target.value })}><option value="owner">The owner (reporter)</option><option value="proxy" disabled={!active?.complaint?.proxy_name}>Authorised proxy{active?.complaint?.proxy_name ? ` — ${active.complaint.proxy_name}` : ' (owner has not authorised one)'}</option></Select>}</Field>
            <Field label="Receiver full name (as on ID)" required>{(fid) => <Input id={fid} value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} maxLength={80} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID type">{(fid) => <Select id={fid} value={form.receiverIdType} onChange={(e) => setForm({ ...form, receiverIdType: e.target.value })}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
              <Field label="Last 4 of ID" required>{(fid) => <Input id={fid} value={form.receiverIdLast4} maxLength={4} onChange={(e) => setForm({ ...form, receiverIdLast4: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />}</Field>
            </div>
            <Field label="Notes" optionalLabel="optional">{(fid) => <Input id={fid} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />}</Field>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={form.checked} onChange={(e) => setForm({ ...form, checked: e.target.checked })} /> I checked the receiver’s photo ID in person and it matches the name above.</label>
            <Button className="w-full" disabled={!form.checked || form.receiverName.trim().length < 2 || form.receiverIdLast4.length !== 4} loading={busy} onClick={start}><ShieldCheck className="h-4 w-4" /> Issue one-time code</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!release} onClose={() => setRelease(null)} title="Confirm physical release">
        {release && (
          <div className="space-y-4 text-sm">
            <Notice tone="success" title="Receiver acknowledged receipt"><p>{release.acknowledgmentText}</p><p className="mt-1 text-xs">{fmtDate(release.acknowledgedAt)} · {release.verificationMethod}</p></Notice>
            {release.evidenceFileId && <div><p className="label">Signature</p><StaffImage fileId={release.evidenceFileId} alt="Receiver signature" /></div>}
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={confirmRelease} onChange={(e) => setConfirmRelease(e.target.checked)} /> I have physically handed the item to {release.receiverName}.</label>
            <Button className="w-full" disabled={!confirmRelease} loading={busy} onClick={() => call(async () => { await apiPost(`/api/staff/handovers/${release.handoverId}/release`, { confirmPhysicalRelease: true }, { auth: 'staff' }); toast('Item released — marked Returned'); setRelease(null); })}><CheckCircle2 className="h-4 w-4" /> Confirm release</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
