import { Camera, CheckCircle2, Lock, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CATEGORIES, complaintInput } from '../../../shared/domain';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { useI18n } from '../../lib/i18n';
import { compressImage } from '../../lib/image';
import { useMe } from './common';

type Form = Record<'guestName' | 'email' | 'category' | 'itemName' | 'description' | 'colorFeatures' | 'lastSeenLocation' | 'lostDate' | 'lostTime' | 'ownershipEvidence' | 'visitInfo', string>;
const empty: Form = { guestName: '', email: '', category: '', itemName: '', description: '', colorFeatures: '', lastSeenLocation: '', lostDate: '', lostTime: '', ownershipEvidence: '', visitInfo: '' };

export default function Report() {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const { profile } = useMe();
  const guest = profile.type === 'Guest';
  const { config, status } = useConfig();
  const [form, setForm] = useState<Form>({ ...empty, guestName: guest ? profile.name : '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Form | 'consent' | 'photo', string>>>({});
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<{ mime: string; dataBase64: string; previewUrl: string; bytes: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const startedAt = useRef(Date.now());
  // One idempotency key per filled form: retries after a network failure never create duplicates.
  const idemKey = useRef(crypto.randomUUID());
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };
  async function onPhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setErrors((e) => ({ ...e, photo: undefined }));
    try { setPhoto(await compressImage(file)); } catch (e) { setErrors((er) => ({ ...er, photo: (e as Error).message })); } finally { setPhotoBusy(false); }
  }

  async function submit(e?: FormEvent, confirmNotDuplicate = false) {
    e?.preventDefault();
    setFailure(null);
    const parsed = complaintInput.safeParse(form);
    const errs: typeof errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[(i.path[0] as keyof Form) ?? 'itemName'] ??= i.message;
    if (guest && form.guestName.trim().length < 2) errs.guestName = 'Enter your full name';
    if (!consent) errs.consent = 'Please confirm to continue';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      toast('Please check the highlighted fields.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ complaintId: string }>('/api/me/complaints', {
        ...form,
        photo: photo ? { mime: photo.mime, dataBase64: photo.dataBase64 } : undefined,
        idempotencyKey: idemKey.current,
        elapsedMs: Date.now() - startedAt.current,
        website: honeypot.current?.value ?? '',
        confirmNotDuplicate,
      }, { auth: 'reporter', timeoutMs: 60000 });
      // Shown only after the backend confirmed the write.
      toast(`${t('report.success')}: ${res.complaintId}`);
      nav(`/me/complaints/${res.complaintId}`, { replace: true, state: { justSubmitted: true } });
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'possible_duplicate') { setDuplicate((ae.details as { complaintId?: string })?.complaintId ?? ''); return; }
      if (ae.details) setErrors(ae.details as typeof errors);
      setFailure(ae.message);
    } finally {
      setSubmitting(false);
    }
  }

  const ready = status === 'ready';
  const closed = config && (!config.submissionsOpen || (guest && !config.guestReportsOpen));
  const F = (k: keyof Form, label: string, el: (id: string, d?: string) => React.ReactNode, opts: { required?: boolean; hint?: string; className?: string } = {}) => (
    <Field label={label} required={opts.required} optionalLabel={t('common.optional')} error={errors[k]} hint={opts.hint} className={opts.className}>{(id, d) => el(id, d)}</Field>
  );
  return (
    <div>
      <PageHeader eyebrow="FindBack" title={t('me.submit')} lead={t('submit.lead')} />
      {closed && <Notice tone="warn" className="mb-6">{t('submit.closed')}</Notice>}
      <form onSubmit={submit} noValidate className="space-y-6">
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <Card className="space-y-4 p-6 sm:p-8">
          <h2 className="text-lg font-bold">{t('report.identity')}</h2>
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50/70 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              {guest ? <p><strong>{t('me.guest')}</strong> · {profile.phone}</p> : <p><strong>{profile.name}</strong> · {profile.studentId} · {profile.department}<br />{t('me.student')} · {profile.phone}</p>}
              <p className="mt-1 text-xs text-emerald-800/80">Your identity is attached from your verified sign-in and cannot be edited here.</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {guest && F('guestName', t('report.guestName'), (id, d) => <Input id={id} aria-describedby={d} value={form.guestName} onChange={set('guestName')} autoComplete="name" invalid={!!errors.guestName} maxLength={80} />, { required: true })}
            {F('email', t('submit.email'), (id, d) => <Input id={id} aria-describedby={d} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={!!errors.email} maxLength={120} />)}
            {guest && F('visitInfo', t('report.visit'), (id, d) => <Input id={id} aria-describedby={d} value={form.visitInfo} onChange={set('visitInfo')} invalid={!!errors.visitInfo} maxLength={300} />, { hint: t('report.visitHint'), className: 'sm:col-span-2' })}
          </div>
        </Card>

        <Card className="space-y-5 p-6 sm:p-8">
          <h2 className="text-lg font-bold">{t('submit.sec2')}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {F('category', t('submit.category'), (id, d) => (
              <Select id={id} aria-describedby={d} value={form.category} onChange={set('category')} invalid={!!errors.category} required>
                <option value="">{t('submit.categoryPick')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            ), { required: true })}
            {F('itemName', t('submit.itemName'), (id, d) => <Input id={id} aria-describedby={d} value={form.itemName} onChange={set('itemName')} invalid={!!errors.itemName} placeholder={t('submit.itemNamePh')} maxLength={80} />, { required: true })}
            {F('description', t('submit.description'), (id, d) => <Textarea id={id} aria-describedby={d} value={form.description} onChange={set('description')} invalid={!!errors.description} placeholder={t('submit.descriptionPh')} maxLength={1000} />, { required: true, className: 'sm:col-span-2' })}
            {F('colorFeatures', t('submit.color'), (id, d) => <Input id={id} aria-describedby={d} value={form.colorFeatures} onChange={set('colorFeatures')} invalid={!!errors.colorFeatures} placeholder={t('submit.colorPh')} maxLength={300} />, { required: true, className: 'sm:col-span-2' })}
          </div>
          <div>
            <p className="label">{t('submit.photo')} <span className="font-normal text-ink-400">({t('common.optional')})</span></p>
            {photo ? (
              <div className="flex items-center gap-4 rounded-2xl border border-silver-200 p-3">
                <img src={photo.previewUrl} alt="Selected item" className="h-20 w-20 rounded-xl object-cover" />
                <p className="flex-1 text-sm text-ink-500">{Math.round(photo.bytes / 1024)} KB</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}><Trash2 className="h-4 w-4" /> {t('submit.photoRemove')}</Button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-silver-200 bg-silver-50/50 p-6 text-center transition hover:border-teal-300 hover:bg-teal-50/40 focus-within:ring-4 focus-within:ring-teal-500/15">
                <Camera className="h-7 w-7 text-teal-600" aria-hidden />
                <span className="text-sm font-semibold text-ink-700">{photoBusy ? t('common.loading') : t('submit.photoPick')}</span>
                <span className="text-xs text-ink-500">{t('submit.photoHint')}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} disabled={photoBusy} />
              </label>
            )}
            {errors.photo && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">{errors.photo}</p>}
          </div>
        </Card>

        <Card className="space-y-5 p-6 sm:p-8">
          <h2 className="text-lg font-bold">{t('submit.sec3')}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {F('lastSeenLocation', t('submit.location'), (id, d) => <Input id={id} aria-describedby={d} value={form.lastSeenLocation} onChange={set('lastSeenLocation')} invalid={!!errors.lastSeenLocation} placeholder={t('submit.locationPh')} maxLength={160} />, { required: true, className: 'sm:col-span-2' })}
            {F('lostDate', t('submit.date'), (id, d) => <Input id={id} aria-describedby={d} type="date" max={today} value={form.lostDate} onChange={set('lostDate')} invalid={!!errors.lostDate} />, { required: true })}
            {F('lostTime', t('submit.time'), (id, d) => <Input id={id} aria-describedby={d} type="time" value={form.lostTime} onChange={set('lostTime')} invalid={!!errors.lostTime} />)}
          </div>
        </Card>

        <Card className="space-y-5 p-6 sm:p-8">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Lock className="h-5 w-5 text-teal-600" aria-hidden /> {t('submit.sec4')}</h2>
          {F('ownershipEvidence', t('submit.evidence'), (id, d) => <Textarea id={id} aria-describedby={d} value={form.ownershipEvidence} onChange={set('ownershipEvidence')} invalid={!!errors.ownershipEvidence} maxLength={1000} />, { required: true, hint: t('submit.evidenceHint') })}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1 text-sm text-ink-700">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={!!errors.consent || undefined} />
            <span>{t('submit.consent')} <Link to="/privacy" className="font-semibold text-teal-700 underline">{t('nav.privacy')}</Link></span>
          </label>
          {errors.consent && <p role="alert" className="text-xs font-medium text-rose-600">{errors.consent}</p>}
        </Card>

        {duplicate !== null && (
          <Notice tone="warn" title={t('report.duplicate')}>
            <div className="mt-2 flex flex-wrap gap-2">
              {duplicate && <Link to={`/me/complaints/${duplicate}`} className="font-semibold text-teal-700 underline">{t('report.openExisting')} ({duplicate})</Link>}
              <Button type="button" size="sm" variant="secondary" loading={submitting} onClick={() => submit(undefined, true)}>{t('report.notDuplicate')}</Button>
            </div>
          </Notice>
        )}
        {failure && <Notice tone="error" title={t('submit.errorTitle')}>{failure} {t('submit.retrySafe')}</Notice>}
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-pearl via-pearl/95 to-transparent px-4 pb-4 pt-6 safe-bottom sm:static sm:mx-0 sm:bg-none sm:p-0">
          <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={!ready || !!closed}>
            {submitting ? t('submit.submitting') : <><Send className="h-5 w-5" /> {t('submit.submit')}</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
