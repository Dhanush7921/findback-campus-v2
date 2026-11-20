import { CheckCircle2, FileCheck2, KeyRound, ShieldCheck, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/status';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, Notice, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { EvidenceGallery, EvidencePicker, uploadEvidence, type PendingFile } from './Evidence';
import { Table, useStaff, useStaffGet, type R } from './common';

type Ready = R & { complaint: R | null };
const ID_TYPES = ['College ID card', 'Aadhaar', 'Driving licence', 'Passport', 'Voter ID', 'Other government ID'];

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return <span className={s < 60 ? 'text-rose-600' : ''}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

interface Policy { homeDelivery: boolean; proofRequired: boolean; twoStaff: boolean; deliveryStaff: string[] }
const emptyForm = { receiverType: 'owner', receiverName: '', receiverIdType: 'College ID card', receiverIdLast4: '', notes: '', checked: false, mode: 'counter', deliveryStaff: '', deliveryAddress: '' };

/** Proof of Handover: receiver acknowledgment, identities, times, and the private evidence register for one handover. */
function ProofPanel({ h, policy, onChanged }: { h: R; policy: Policy; onChanged: () => void }) {
  const toast = useToast();
  const me = useStaff().email;
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [kind, setKind] = useState(h.mode === 'delivery' && h.deliveryStaff === me ? 'delivery_proof' : 'handover_photo');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState(0);
  const [code, setCode] = useState<{ code: string; expiresAt: string; receiverPhone: string } | null>(null);
  const locked = !['Pending Acknowledgment', 'Acknowledged', 'Delivered'].includes(h.status);
  const courier = h.mode === 'delivery' && h.deliveryStaff === me;
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); onChanged(); } catch (e) { toast((e as ApiError).message ?? (e as Error).message, 'error'); } finally { setBusy(''); } };
  const rows: [string, string][] = [
    ['Complaint ID', h.complaintId], ['Found item', h.itemId], ['Mode', h.mode === 'delivery' ? 'Home delivery' : 'Counter collection'],
    ['Receiver', `${h.receiverName} (${h.receiverType}) · ${h.receiverIdType} …${h.receiverIdLast4} · ${h.receiverPhone}`],
    ['Claim approved by', h.approvedBy], ['Handover started by', `${h.startedBy} · ${fmtDate(h.startedAt)}`],
    ...(h.mode === 'delivery' ? [['Delivery staff', h.deliveryStaff], ['Delivery address (admin only)', h.deliveryAddress], ['Delivered (actual time)', h.deliveredAt ? `${fmtDate(h.deliveredAt)} by ${h.deliveredBy}` : 'Not yet']] as [string, string][] : []),
    ['Receiver acknowledged', h.acknowledgedAt ? `${fmtDate(h.acknowledgedAt)} · signed “${h.signatureName}”` : 'Not yet'],
    ['Verification', h.verificationMethod || '—'], ['Released by', h.releasedBy ? `${h.releasedBy} · ${fmtDate(h.releasedAt)}` : 'Not yet'],
  ];
  return (
    <div className="space-y-4 text-sm" data-testid="proof-panel">
      <dl className="divide-y divide-silver-100 rounded-xl border border-silver-100">
        {rows.map(([k, v]) => <div key={k} className="grid gap-1 p-2.5 sm:grid-cols-[170px_1fr]"><dt className="font-semibold text-ink-500">{k}</dt><dd className="break-words">{v}</dd></div>)}
      </dl>
      {h.acknowledgmentText && <Notice tone="success" title="Receiver’s digital acknowledgment">{h.acknowledgmentText}</Notice>}
      {courier && h.status === 'Pending Acknowledgment' && (
        <Card className="space-y-2 p-4">
          <p className="font-semibold">At the doorstep</p>
          <p className="text-ink-600">Check the recipient’s photo ID, then issue the one-time code. They enter it on their own verified phone.</p>
          {code ? <p className="rounded-xl bg-emerald-50 p-3 text-center font-mono text-4xl font-extrabold tracking-[0.3em] text-teal-900" data-testid="delivery-code">{code.code}</p>
            : <Button size="sm" loading={busy === 'code'} onClick={() => run('code', async () => setCode(await apiPost(`/api/staff/handovers/${h.handoverId}/delivery-code`, {}, { auth: 'staff' })))}><KeyRound className="h-4 w-4" /> Issue doorstep code</Button>}
          {code && <p className="text-xs text-ink-500">Phone ending {code.receiverPhone.slice(-4)} · expires in <Countdown until={code.expiresAt} /></p>}
        </Card>
      )}
      <EvidenceGallery type="handover" id={h.handoverId} scope="staff" title="Proof of handover" refreshKey={key} />
      {locked ? <p className="text-xs text-ink-500">Evidence is locked because this handover is {h.status}. Nothing can be added, replaced or deleted.</p> : (
        <Card className="space-y-3 p-4">
          <Field label="Evidence type">{(fid) => (
            <Select id={fid} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="handover_photo">Handover photo</option>
              <option value="handover_document">Handover document (e.g. signed register page)</option>
              {courier && <option value="delivery_proof">Delivery proof (photo at delivery)</option>}
            </Select>
          )}</Field>
          <EvidencePicker files={files} onChange={setFiles} allowPdf label="Files" max={6} />
          <Field label="Caption" optionalLabel="optional">{(fid) => <Input id={fid} value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />}</Field>
          <Button size="sm" disabled={!files.length} loading={busy === 'up'} onClick={() => run('up', async () => { const f = await uploadEvidence(`/api/staff/handovers/${h.handoverId}/evidence`, files, kind, caption); setFiles([]); setCaption(''); setKey((k) => k + 1); if (f) throw new Error(`${f} file(s) failed to upload`); toast('Evidence saved'); })}><FileCheck2 className="h-4 w-4" /> Save evidence</Button>
          {policy.proofRequired && h.mode !== 'delivery' && <p className="text-xs text-amber-700">College policy: a handover photo or document is required before release.</p>}
        </Card>
      )}
      {courier && h.status === 'Acknowledged' && (
        <Button className="w-full" loading={busy === 'del'} onClick={() => run('del', async () => { await apiPost(`/api/staff/handovers/${h.handoverId}/delivered`, { confirmDelivered: true }, { auth: 'staff' }); toast('Delivery recorded. Another staff member must finalise it.'); })}><Truck className="h-4 w-4" /> Record delivery completed now</Button>
      )}
    </div>
  );
}

export default function Handovers() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ ready: Ready[]; recent: R[]; policy: Policy }>('/api/staff/handovers');
  const [active, setActive] = useState<Ready | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [proof, setProof] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ handoverId: string; code: string | null; expiresAt: string | null; receiverPhone: string; mode: string } | null>(null);
  const [release, setRelease] = useState<R | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!issued) return; const id = setInterval(reload, 8000); return () => clearInterval(id); }, [issued, reload]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const issuedRow = issued ? data.recent.find((h) => h.handoverId === issued.handoverId) : null;
  const call = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); } };
  const start = () => call(async () => {
    const r = await apiPost<{ handoverId: string; code: string | null; expiresAt: string | null; receiverPhone: string; mode: string }>('/api/staff/handovers', { claimId: active!.claim_id, receiverType: form.receiverType, receiverName: form.receiverName, receiverIdType: form.receiverIdType, receiverIdLast4: form.receiverIdLast4, notes: form.notes, mode: form.mode, deliveryStaff: form.deliveryStaff, deliveryAddress: form.deliveryAddress }, { auth: 'staff' });
    setIssued(r);
  });
  const policy = data.policy;
  const awaiting = data.recent.filter((h) => ['Pending Acknowledgment', 'Acknowledged', 'Delivered'].includes(h.status));
  const proofRow = proof ? data.recent.find((h) => h.handoverId === proof) : null;
  const canRelease = (h: R) => (h.mode === 'delivery' ? h.status === 'Delivered' : h.status === 'Acknowledged');
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
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => { setActive(c); setIssued(null); setForm({ ...emptyForm, receiverName: c.complaint?.name ?? '' }); }}>Start handover</Button></td>
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
                <td className="px-4 py-3 font-mono text-xs">{h.handoverId}<br />{h.complaintId}{h.mode === 'delivery' && <span className="chip mt-1 bg-sky-100 text-sky-900"><Truck className="h-3 w-3" /> Delivery</span>}</td>
                <td className="px-4 py-3">{h.receiverName}<span className="block text-xs text-ink-500">{h.receiverType} · {h.receiverIdType} …{h.receiverIdLast4} · {h.receiverPhone}</span>{h.mode === 'delivery' && <span className="block text-xs text-ink-500">Courier: {h.deliveryStaff}</span>}</td>
                <td className="px-4 py-3"><StatusBadge status={h.status} translate={false} /></td>
                <td className="px-4 py-3 text-xs">{h.status === 'Delivered' ? `Delivered ${fmtDate(h.deliveredAt)}` : h.status === 'Acknowledged' ? fmtDate(h.acknowledgedAt) : h.challengeExpiresAt ? <Countdown until={h.challengeExpiresAt} /> : 'Out for delivery'}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                  <Button size="sm" variant="soft" onClick={() => setProof(h.handoverId)}>Proof of handover</Button>
                  {canRelease(h) && <Button size="sm" onClick={() => { setRelease(h); setConfirmRelease(false); }}>{h.mode === 'delivery' ? 'Finalise delivery' : 'Confirm release'}</Button>}
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => { const reason = window.prompt('Reason for cancelling this handover?'); if (reason) void call(async () => { await apiPost(`/api/staff/handovers/${h.handoverId}/cancel`, { reason }, { auth: 'staff' }); toast('Handover cancelled'); }); }}>Cancel</Button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Completed handovers</h2>
        <Table head={['Receipt', 'Complaint / item', 'Receiver', 'Approved / released by', 'Released', '']} empty={!data.recent.some((h) => h.status === 'Released')}>
          {data.recent.filter((h) => h.status === 'Released').map((h) => (
            <tr key={h.handoverId}>
              <td className="px-4 py-3 font-mono text-xs">{h.handoverId}</td>
              <td className="px-4 py-3 font-mono text-xs">{h.complaintId}<br />{h.itemId}</td>
              <td className="px-4 py-3">{h.receiverName}<span className="block text-xs text-ink-500">{h.receiverType}{h.signatureName ? ` · signed “${h.signatureName}”` : ''}</span></td>
              <td className="px-4 py-3 text-xs">{h.approvedBy}<br />{h.releasedBy}</td>
              <td className="px-4 py-3 text-xs">{fmtDate(h.releasedAt)}{h.mode === 'delivery' && <span className="block">Home delivery · delivered {fmtDate(h.deliveredAt)}</span>}</td>
              <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setProof(h.handoverId)}>Proof</Button></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={!!active} onClose={() => { setActive(null); setIssued(null); }} title={issued ? (issued.code ? 'Show this code to the receiver' : 'Home delivery created') : 'Start handover'}>
        {issued && !issued.code ? (
          <div className="space-y-4 text-sm">
            <Notice tone="success" title={`Handover ${issued.handoverId} is out for delivery`}>The assigned delivery staff opens <em>Proof of handover</em> at the doorstep to issue the one-time code, uploads delivery proof and records the delivery. Another staff member then finalises it.</Notice>
            <Button variant="secondary" className="w-full" onClick={() => { setActive(null); setIssued(null); }}>Close</Button>
          </div>
        ) : issued && issued.code && issued.expiresAt ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-ink-600">The receiver must open FindBack on the phone ending <strong>{issued.receiverPhone.slice(-4)}</strong>, sign in with OTP, choose <em>Confirm receipt</em> and enter:</p>
            <p className="rounded-2xl bg-gradient-to-br from-emerald-50 to-cyan-50 p-5 font-mono text-5xl font-extrabold tracking-[0.3em] text-teal-900 select-none">{issued.code}</p>
            <p className="text-xs text-ink-500">Expires in <Countdown until={issued.expiresAt} /> · single use · never stored in readable form</p>
            {issuedRow?.status === 'Acknowledged' ? <Notice tone="success" title="Receipt confirmed by receiver">Close this window and confirm release.</Notice> : <p className="text-xs text-ink-400">Waiting for the receiver… this updates automatically.</p>}
            <Button variant="secondary" className="w-full" onClick={() => { setActive(null); setIssued(null); }}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {policy.homeDelivery && (
              <Field label="Handover mode">{(fid) => <Select id={fid} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="counter">Counter collection</option><option value="delivery">Home delivery</option></Select>}</Field>
            )}
            {form.mode === 'delivery' && (
              <>
                <Field label="Delivery staff" required>{(fid) => <Select id={fid} value={form.deliveryStaff} onChange={(e) => setForm({ ...form, deliveryStaff: e.target.value })}><option value="">Choose…</option>{policy.deliveryStaff.map((e) => <option key={e}>{e}</option>)}</Select>}</Field>
                <Field label="Delivery address" required hint="Admin-only. Never shown to management or on any public page.">{(fid) => <Input id={fid} value={form.deliveryAddress} maxLength={300} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} />}</Field>
              </>
            )}
            <Notice tone="warn">{form.mode === 'delivery' ? 'The delivery staff must check this photo ID at the doorstep.' : 'Check a photo ID in person.'} Record only the ID type and last 4 characters — never the full number.</Notice>
            <Field label="Who is collecting?">{(fid) => <Select id={fid} value={form.receiverType} onChange={(e) => setForm({ ...form, receiverType: e.target.value })}><option value="owner">The owner (reporter)</option><option value="proxy" disabled={!active?.complaint?.proxy_name}>Authorised proxy{active?.complaint?.proxy_name ? ` — ${active.complaint.proxy_name}` : ' (owner has not authorised one)'}</option></Select>}</Field>
            <Field label="Receiver full name (as on ID)" required>{(fid) => <Input id={fid} value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} maxLength={80} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID type">{(fid) => <Select id={fid} value={form.receiverIdType} onChange={(e) => setForm({ ...form, receiverIdType: e.target.value })}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
              <Field label="Last 4 of ID" required>{(fid) => <Input id={fid} value={form.receiverIdLast4} maxLength={4} onChange={(e) => setForm({ ...form, receiverIdLast4: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />}</Field>
            </div>
            <Field label="Notes" optionalLabel="optional">{(fid) => <Input id={fid} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />}</Field>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={form.checked} onChange={(e) => setForm({ ...form, checked: e.target.checked })} /> {form.mode === 'delivery' ? 'I confirm the recipient’s identity details above match the complaint, and the delivery staff will re-check the photo ID at the doorstep.' : 'I checked the receiver’s photo ID in person and it matches the name above.'}</label>
            <Button className="w-full" disabled={!form.checked || form.receiverName.trim().length < 2 || form.receiverIdLast4.length !== 4 || (form.mode === 'delivery' && (!form.deliveryStaff || form.deliveryAddress.trim().length < 10))} loading={busy} onClick={start}>{form.mode === 'delivery' ? <><Truck className="h-4 w-4" /> Create home delivery</> : <><ShieldCheck className="h-4 w-4" /> Issue one-time code</>}</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!proofRow} onClose={() => setProof(null)} title="Proof of handover">
        {proofRow && <ProofPanel key={proofRow.handoverId + proofRow.status} h={proofRow} policy={policy} onChanged={reload} />}
      </Modal>

      <Modal open={!!release} onClose={() => setRelease(null)} title={release?.mode === 'delivery' ? 'Finalise home delivery' : 'Confirm physical release'}>
        {release && (
          <div className="space-y-4 text-sm">
            <Notice tone="success" title="Receiver acknowledged receipt"><p>{release.acknowledgmentText}</p><p className="mt-1 text-xs">{fmtDate(release.acknowledgedAt)} · {release.verificationMethod}</p></Notice>
            {release.mode === 'delivery' && <Notice tone="info" title="Delivery recorded">Delivered by {release.deliveredBy} at {fmtDate(release.deliveredAt)}. Review the delivery proof before finalising.</Notice>}
            <EvidenceGallery type="handover" id={release.handoverId} scope="staff" title="Proof of handover" />
            <label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={confirmRelease} onChange={(e) => setConfirmRelease(e.target.checked)} /> {release.mode === 'delivery' ? `I reviewed the recipient acknowledgment and delivery proof, and verify the item reached ${release.receiverName}.` : `I have physically handed the item to ${release.receiverName}.`}</label>
            <Button className="w-full" disabled={!confirmRelease} loading={busy} onClick={() => call(async () => { await apiPost(`/api/staff/handovers/${release.handoverId}/release`, { confirmPhysicalRelease: true }, { auth: 'staff' }); toast('Verified — marked Returned'); setRelease(null); })}><CheckCircle2 className="h-4 w-4" /> Confirm release</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
