import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CATEGORIES, foundItemInput } from '../../../shared/domain';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { EvidencePicker, uploadEvidence, type PendingFile } from './Evidence';

const empty = { category: '', itemName: '', publicDescription: '', privateDetails: '', colorFeatures: '', foundLocation: '', foundDate: new Date().toISOString().slice(0, 10), storageLocation: '' };

export default function RegisterItem() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState(empty);
  const [photos, setPhotos] = useState<PendingFile[]>([]);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = foundItemInput.safeParse(f);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await apiPost<{ itemId: string }>('/api/staff/found-items', parsed.data, { auth: 'staff', timeoutMs: 60000 });
      // Photos go one per request to the evidence register (private bucket, your identity + time, audited).
      const failed = await uploadEvidence(`/api/staff/found-items/${r.itemId}/evidence`, photos, 'item_photo', '', (n) => setProgress(`Uploading photo ${n} of ${photos.length}…`));
      setProgress('');
      toast(failed ? `Registered ${r.itemId}, but ${failed} photo(s) failed. Add them again on the item page.` : `Registered ${r.itemId}${photos.length ? ` with ${photos.length} photo(s)` : ''}`, failed ? 'error' : undefined);
      nav(`/staff/inventory/${r.itemId}`);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.details) setErrors(ae.details);
      toast(ae.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const field = (k: keyof typeof empty, label: string, el: (id: string) => React.ReactNode, o: { req?: boolean; hint?: string; cls?: string } = {}) => (
    <Field label={label} required={o.req} optionalLabel="optional" error={errors[k]} hint={o.hint} className={o.cls}>{(id) => el(id)}</Field>
  );
  return (
    <>
      <PageHeader title="Register found item" lead="Record what was handed in. Public description is what students may see if you propose a match; private details stay staff-only for verification." />
      <form onSubmit={submit} noValidate>
        <Card className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
          {field('category', 'Category', (id) => <Select id={id} value={f.category} onChange={set('category')} invalid={!!errors.category}><option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>, { req: true })}
          {field('itemName', 'Item name', (id) => <Input id={id} value={f.itemName} onChange={set('itemName')} invalid={!!errors.itemName} placeholder="e.g. Black backpack" />, { req: true })}
          {field('publicDescription', 'Public description', (id) => <Textarea id={id} value={f.publicDescription} onChange={set('publicDescription')} invalid={!!errors.publicDescription} />, { req: true, cls: 'sm:col-span-2', hint: 'General description only — do not reveal identifying details such as contents, serial numbers or names.' })}
          {field('privateDetails', 'Private verification details', (id) => <Textarea id={id} value={f.privateDetails} onChange={set('privateDetails')} />, { cls: 'sm:col-span-2', hint: 'Contents, serial numbers, names written inside, lock-screen image. Never shown to students.' })}
          {field('colorFeatures', 'Colour & features', (id) => <Input id={id} value={f.colorFeatures} onChange={set('colorFeatures')} invalid={!!errors.colorFeatures} />, { req: true })}
          {field('foundLocation', 'Found location', (id) => <Input id={id} value={f.foundLocation} onChange={set('foundLocation')} invalid={!!errors.foundLocation} />, { req: true })}
          {field('foundDate', 'Found date', (id) => <Input id={id} type="date" value={f.foundDate} max={new Date().toISOString().slice(0, 10)} onChange={set('foundDate')} invalid={!!errors.foundDate} />, { req: true })}
          {field('storageLocation', 'Storage location', (id) => <Input id={id} value={f.storageLocation} onChange={set('storageLocation')} invalid={!!errors.storageLocation} placeholder="e.g. Cabinet A, shelf 2" />, { req: true })}
          <div className="sm:col-span-2"><EvidencePicker files={photos} onChange={setPhotos} label="Item photos" /></div>
          <Notice tone="info" className="sm:col-span-2">Photos are stored in a private Cloud Storage bucket with your staff identity and the time, and every upload is audited. They cannot be replaced or deleted later.</Notice>
          <div className="sm:col-span-2 flex items-center gap-3"><Button type="submit" loading={busy}>Register item</Button>{progress && <span className="text-sm text-ink-500">{progress}</span>}</div>
        </Card>
      </form>
    </>
  );
}
