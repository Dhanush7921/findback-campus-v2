import { Camera, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CATEGORIES, foundItemInput } from '../../../shared/domain';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { compressImage } from '../../lib/image';

const empty = { category: '', itemName: '', publicDescription: '', privateDetails: '', colorFeatures: '', foundLocation: '', foundDate: new Date().toISOString().slice(0, 10), storageLocation: '' };

export default function RegisterItem() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState(empty);
  const [photos, setPhotos] = useState<{ mime: string; dataBase64: string; previewUrl: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    for (const file of [...files].slice(0, 3 - photos.length)) {
      try { const p = await compressImage(file); setPhotos((s) => [...s, p]); } catch (e) { toast((e as Error).message, 'error'); }
    }
  }
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
      const r = await apiPost<{ itemId: string }>('/api/staff/found-items', { ...parsed.data, photos: photos.map(({ mime, dataBase64 }) => ({ mime, dataBase64 })) }, { auth: 'staff', timeoutMs: 90000 });
      toast(`Registered ${r.itemId}`);
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
          <div className="sm:col-span-2">
            <p className="label">Photos <span className="font-normal text-ink-400">(up to 3, staff-only)</span></p>
            <div className="flex flex-wrap gap-3">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.previewUrl} alt={`Photo ${i + 1}`} className="h-24 w-24 rounded-xl object-cover" />
                  <button type="button" className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-white shadow" aria-label="Remove photo" onClick={() => setPhotos((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-600" /></button>
                </div>
              ))}
              {photos.length < 3 && (
                <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-silver-200 text-teal-600 hover:border-teal-300">
                  <Camera className="h-6 w-6" /><input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              )}
            </div>
          </div>
          <Notice tone="info" className="sm:col-span-2">Photos are stored in the private FindBack Drive folder and served only to signed-in staff.</Notice>
          <div className="sm:col-span-2"><Button type="submit" loading={busy}>Register item</Button></div>
        </Card>
      </form>
    </>
  );
}
