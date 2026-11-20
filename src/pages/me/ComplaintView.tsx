import { ArrowLeft, Building2, Clock, FileCheck2, Handshake, Image as ImageIcon, MessageSquare, Search, UserCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { StatusBadge, StatusStepper } from '../../components/status';
import { useToast } from '../../components/toast';
import { COMPLAINT_FIELDS, EditModal } from '../../components/EditForms';
import { Button, ButtonLink, Card, ErrorState, Field, Input, Modal, Notice, PageSkeleton, Textarea, fmtDate } from '../../components/ui';
import { ApiError, apiBlobUrl, apiPost } from '../../lib/api';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { useMeGet } from './common';

interface View {
  complaint: Record<string, string> & { hasPhoto: boolean; proxy: { name: string; phone: string; authorizedAt: string } | null };
  timeline: { status: string; at: string; message: string }[];
  messages: { id: string; message: string; at: string }[];
  matches: { itemId: string; proposedAt: string; note: string; item: Record<string, string>; claimStatus: string | null }[];
  claims: { claimId: string; itemId: string; status: string; decisionNotes: string }[];
  collection: { office: string; hours: string; instructions: string; contactEmail: string; contactPhone: string };
  pendingHandover: { handoverId: string; expiresAt: string } | null;
  receipt: Record<string, string> | null;
}

export default function ComplaintView() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const loc = useLocation();
  const { data, error, reload } = useMeGet<View>(`/api/me/complaints/${id}`);
  const [claimFor, setClaimFor] = useState<string | null>(null);
  const [evidence, setEvidence] = useState('');
  const [proxy, setProxy] = useState({ name: '', phone: '', consent: false });
  const [extra, setExtra] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const c = data.complaint;
  const act = async (path: string, body: unknown, ok: string, after?: () => void) => {
    setBusy(true);
    try { await apiPost(path, body, { auth: 'reporter' }); toast(ok); after?.(); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  const open = !['Returned', 'Closed', 'Cancelled', 'Rejected'].includes(c.status);
  return (
    <div className="space-y-6">
      <Link to="/me" className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link>
      {(loc.state as { justSubmitted?: boolean } | null)?.justSubmitted && (
        <Notice tone="success" title={t('report.success')}>{t('report.successText')} <strong className="font-mono">{c.complaintId}</strong>. You can track it here any time after signing in with your phone.</Notice>
      )}
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-ink-500">{c.complaintId}</p>
            <h1 className="mt-1 text-2xl font-extrabold">{c.itemName}</h1>
            <p className="mt-1 text-sm text-ink-500">{c.category} · {c.lastSeenLocation} · {fmtDate(c.lostDate, false)}</p>
          </div>
          <div className="flex items-center gap-2"><StatusBadge status={c.status} />{['Submitted', 'Under Review'].includes(c.status) && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}</div>
        </div>
        {editing && <EditModal open title="Edit your complaint" fields={[...COMPLAINT_FIELDS, { key: 'ownershipEvidence', label: 'Private ownership evidence', type: 'textarea', required: true, max: 1000 }]} note="You can edit details until the office starts verification. Your verified name and phone cannot be changed." initial={{ category: c.category, itemName: c.itemName, description: c.description, colorFeatures: c.colorFeatures, lastSeenLocation: c.lastSeenLocation, lostDate: c.lostDate, lostTime: c.lostTime, ownershipEvidence: c.ownershipEvidence }} onClose={() => setEditing(false)} onSave={async (v) => { await apiPost(`/api/me/complaints/${c.complaintId}/edit`, v, { auth: 'reporter' }); await reload(); }} />}
        <div className="mt-6"><StatusStepper status={c.status} /></div>
        <p className="mt-5 text-sm text-ink-700">{t(`statusDesc.${c.status}` as I18nKey)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-400"><Clock className="h-3.5 w-3.5" /> {t('common.lastUpdated')} {fmtDate(c.updatedAt)}</p>
      </Card>

      {data.pendingHandover && (
        <Notice tone="success" title={t('me.pendingHandover')}>
          <p>{t('me.pendingHandoverText')}</p>
          <ButtonLink to="/me/acknowledge" size="sm" className="mt-3"><Handshake className="h-4 w-4" /> {t('me.confirmNow')}</ButtonLink>
        </Notice>
      )}

      {data.receipt && (
        <Card className="print-card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold"><FileCheck2 className="h-5 w-5 text-teal-600" /> {t('cv.receipt')}</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[['Receipt', data.receipt.handoverId], ['Complaint', data.receipt.complaintId], ['Found item', data.receipt.itemId], ['Received by', `${data.receipt.receiverName} (${data.receipt.receiverType})`], ['Receipt confirmed', fmtDate(data.receipt.acknowledgedAt)], ['Released', fmtDate(data.receipt.releasedAt)], ['Verification', data.receipt.verificationMethod]].map(([k, v]) => (
              <div key={k} className={k === 'Verification' ? 'sm:col-span-2' : ''}><dt className="text-xs text-ink-500">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>
            ))}
          </dl>
          <Button variant="secondary" size="sm" className="mt-4 no-print" onClick={() => window.print()}>Print / save receipt</Button>
        </Card>
      )}

      {!!data.matches.length && (
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Search className="h-5 w-5 text-teal-600" /> {t('cv.matches')}</h2>
          <div className="space-y-3">
            {data.matches.map((m) => (
              <div key={m.itemId} className="rounded-2xl border border-silver-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{m.item.itemName} <span className="text-xs font-normal text-ink-500">· {m.item.category}</span></p>
                    <p className="mt-1 text-sm text-ink-700">{m.item.description}</p>
                    <p className="mt-1 text-xs text-ink-500">{t('portal.foundAt')} {m.item.foundLocation} · {t('portal.foundOn')} {fmtDate(m.item.foundDate, false)}</p>
                  </div>
                  {m.claimStatus ? <StatusBadge status={m.claimStatus} translate={false} /> : open && c.status === 'Potential Match' && <Button size="sm" onClick={() => setClaimFor(m.itemId)}>{t('cv.claimSubmit')}</Button>}
                </div>
                {m.note && <p className="mt-2 rounded-lg bg-silver-50 p-2 text-xs text-ink-600">{m.note}</p>}
              </div>
            ))}
          </div>
          {data.claims.filter((x) => x.decisionNotes).map((x) => <Notice key={x.claimId} tone={x.status === 'Approved' ? 'success' : 'warn'} className="mt-3">{x.status}: {x.decisionNotes}</Notice>)}
        </Card>
      )}

      {['Ready for Collection', 'Awaiting Receiver Confirmation'].includes(c.status) && (
        <Card className="p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Building2 className="h-5 w-5 text-teal-600" /> {t('cv.collection')}</h2>
          <p className="text-sm text-ink-700">{c.collectionInstructions || data.collection.instructions}</p>
          <p className="mt-2 text-sm"><strong>{t('portal.office')}:</strong> {data.collection.office}<br /><strong>{t('portal.hours')}:</strong> {data.collection.hours}</p>
          <div className="mt-5 border-t border-silver-100 pt-5">
            <h3 className="flex items-center gap-2 font-bold"><UserCheck className="h-4 w-4 text-teal-600" /> {t('cv.proxy')}</h3>
            {c.proxy ? <p className="mt-2 text-sm text-ink-700">Authorised collector: <strong>{c.proxy.name}</strong> ({c.proxy.phone}) since {fmtDate(c.proxy.authorizedAt)}</p> : <p className="mt-1 text-sm text-ink-500">{t('cv.proxyText')}</p>}
            {c.status === 'Ready for Collection' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t('cv.proxyName')}>{(fid) => <Input id={fid} value={proxy.name} onChange={(e) => setProxy({ ...proxy, name: e.target.value })} maxLength={80} />}</Field>
                <Field label={t('cv.proxyPhone')}>{(fid) => <Input id={fid} type="tel" value={proxy.phone} onChange={(e) => setProxy({ ...proxy, phone: e.target.value })} maxLength={20} />}</Field>
                <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={proxy.consent} onChange={(e) => setProxy({ ...proxy, consent: e.target.checked })} /> {t('cv.proxyConsent')}</label>
                <Button variant="secondary" disabled={!proxy.consent || proxy.name.length < 2 || proxy.phone.length < 8} loading={busy} onClick={() => act(`/api/me/complaints/${id}/proxy`, { proxyName: proxy.name, proxyPhone: proxy.phone, consent: true }, 'Collector authorised', () => setProxy({ name: '', phone: '', consent: false }))}>{t('cv.proxySave')}</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-bold">{t('cv.timeline')}</h2>
          <ol className="relative space-y-4 border-l-2 border-teal-100 pl-5">
            {[...data.timeline].reverse().map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${i === 0 ? 'brand-gradient ring-4 ring-teal-100' : 'bg-teal-300'}`} />
                <StatusBadge status={e.status} />
                <p className="mt-1 text-sm text-ink-700">{e.message}</p>
                <p className="text-xs text-ink-400">{fmtDate(e.at)}</p>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><MessageSquare className="h-5 w-5 text-teal-600" /> {t('cv.messages')}</h2>
          {!data.messages.length ? <p className="text-sm text-ink-500">{t('portal.noUpdates')}</p> : (
            <ul className="space-y-3">{[...data.messages].reverse().map((m) => <li key={m.id} className="rounded-xl bg-silver-50 p-3 text-sm"><p>{m.message}</p><p className="mt-1 text-xs text-ink-400">{fmtDate(m.at)}</p></li>)}</ul>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-bold">{t('cv.details')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[['Reported by', `${c.name}${c.studentId ? ` (${c.studentId})` : ''} · ${c.reporterType}`], [t('submit.description'), c.description], [t('submit.color'), c.colorFeatures], [t('submit.evidence'), c.ownershipEvidence], ...(c.visitInfo ? [[t('report.visit'), c.visitInfo]] : []), ...(c.extraInfo ? [['Additional information', c.extraInfo]] : [])].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-ink-500">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>
          ))}
        </dl>
        {c.hasPhoto && (photoUrl ? <img src={photoUrl} alt="Your photo of the item" className="mt-4 max-h-64 rounded-xl" /> : <Button variant="ghost" size="sm" className="mt-3" onClick={async () => setPhotoUrl(await apiBlobUrl(`/api/me/complaints/${id}/photo`, 'reporter'))}><ImageIcon className="h-4 w-4" /> {t('portal.yourPhoto')}</Button>)}
        {open && (
          <div className="mt-5 flex flex-col gap-2 border-t border-silver-100 pt-5 sm:flex-row sm:items-end">
            <Field label={t('portal.extraInfo')} className="flex-1">{(fid) => <Input id={fid} value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={1000} />}</Field>
            <Button variant="secondary" disabled={extra.trim().length < 2} loading={busy} onClick={() => act(`/api/me/complaints/${id}/update`, { extraInfo: extra }, t('portal.updateSaved'), () => setExtra(''))}>{t('common.save')}</Button>
          </div>
        )}
        {open && ['Submitted', 'Under Review', 'Potential Match', 'Ownership Verification', 'Ready for Collection'].includes(c.status) && (
          <button className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-rose-700 hover:underline" onClick={() => setCancelOpen(true)}><XCircle className="h-4 w-4" /> {t('cv.cancel')}</button>
        )}
      </Card>

      <Modal open={!!claimFor} onClose={() => setClaimFor(null)} title={t('cv.claimSubmit')}>
        <div className="space-y-4">
          <Field label={t('cv.claimEvidence')} hint={t('cv.claimHint')} required>{(fid, d) => <Textarea id={fid} aria-describedby={d} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} />}</Field>
          <Button className="w-full" disabled={evidence.trim().length < 10} loading={busy} onClick={() => act(`/api/me/complaints/${id}/claim`, { itemId: claimFor, evidence }, t('portal.claimSent'), () => { setClaimFor(null); setEvidence(''); })}>{t('portal.claimSubmit')}</Button>
        </div>
      </Modal>
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('cv.cancel')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-600">{t('cv.cancelText')}</p>
          <Field label="Reason" optionalLabel={t('common.optional')}>{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
          <Button variant="danger" className="w-full" loading={busy} onClick={() => act(`/api/me/complaints/${id}/cancel`, { reason }, 'Complaint cancelled', () => setCancelOpen(false))}>{t('cv.cancel')}</Button>
        </div>
      </Modal>
    </div>
  );
}
