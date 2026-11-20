import { CheckCircle2, Eraser, Handshake } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Field, Input, Notice, PageHeader, PageSkeleton, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useMe, useMeGet } from './common';

interface Pending { handoverId: string; complaintId: string; receiverType: string; receiverName: string; expiresAt: string; item: { itemName: string; category: string } | null }

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = 160 * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b2b2a';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div>
      <canvas
        ref={ref}
        className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-silver-200 bg-white"
        aria-label="Signature pad"
        onPointerDown={(e) => { drawing.current = true; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ref.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; }}
        onPointerUp={() => { drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')); }}
      />
      <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-900" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); }}><Eraser className="h-3.5 w-3.5" /> Clear</button>
    </div>
  );
}

export default function Acknowledge() {
  const { t } = useI18n();
  const toast = useToast();
  const { profile } = useMe();
  const { data, error, reload } = useMeGet<{ rows: Pending[] }>('/api/me/handovers');
  const [code, setCode] = useState('');
  const [name, setName] = useState(profile.name);
  const [accept, setAccept] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  if (done) return <Card className="p-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-teal-600" /><h1 className="mt-3 text-2xl font-extrabold">{t('ack.done')}</h1><Link to={`/me/complaints/${done}`} className="mt-4 inline-block font-semibold text-teal-700 underline">View complaint</Link></Card>;
  const h = data.rows[0];
  if (!h) return <EmptyState title={t('ack.none')} action={<Link to="/me" className="font-semibold text-teal-700 underline">{t('common.back')}</Link>} />;
  const submit = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/me/handovers/${h.handoverId}/acknowledge`, { code, signatureName: name, accept: true, signature: sig ? { mime: 'image/png', dataBase64: sig.split(',')[1] } : undefined }, { auth: 'reporter' });
      setDone(h.complaintId);
    } catch (e) {
      toast((e as ApiError).message, 'error');
      if ((e as ApiError).code === 'already_used' || (e as ApiError).code === 'expired') await reload();
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t('ack.title')} lead={t('ack.lead')} />
      <Card className="space-y-5 p-6 sm:p-8">
        <div className="flex items-start gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900">
          <Handshake className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">{h.item?.itemName ?? 'Item'} · <span className="font-mono">{h.complaintId}</span></p><p className="text-xs">{h.receiverType === 'proxy' ? `Collecting on behalf of the owner as ${h.receiverName}` : `Collecting as ${h.receiverName}`} · code valid until {fmtDate(h.expiresAt)}</p></div>
        </div>
        <Field label={t('ack.code')} required>{(fid) => <Input id={fid} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono text-2xl tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
        <Field label={t('ack.signName')} required>{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
        <div><p className="label">{t('ack.draw')}</p><SignaturePad onChange={setSig} /></div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> {t('ack.accept')}</label>
        <Notice tone="info">Only confirm when the item is physically in your hands. The office will record the release after your confirmation.</Notice>
        <Button size="lg" className="w-full" disabled={!accept || code.length !== 6 || name.trim().length < 2} loading={busy} onClick={submit}>{t('ack.submit')}</Button>
      </Card>
    </div>
  );
}
