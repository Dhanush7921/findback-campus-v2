import { Camera, FileText, ImagePlus, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_EVIDENCE_BYTES } from '../../../shared/domain';
import { useToast } from '../../components/toast';
import { Button, Card, Skeleton, fmtDate } from '../../components/ui';
import { apiBlobUrl, apiPost } from '../../lib/api';
import { compressImage } from '../../lib/image';
import { useStaffGet } from './common';

export interface PendingFile { mime: string; dataBase64: string; previewUrl: string; bytes: number; name: string }
export interface EvidenceRow { evidenceId: string; createdAt: string; kind: string; mime: string; bytes: number; sha256: string; uploadedBy: string; uploadedRole: string; caption: string; withheld: boolean; complaintId: string }

export const KIND_LABEL: Record<string, string> = {
  item_photo: 'Item photo', handover_photo: 'Handover photo', handover_document: 'Handover document',
  delivery_proof: 'Delivery proof', signature: 'Receiver signature',
};

async function readPdf(file: File): Promise<PendingFile> {
  if (file.size > MAX_EVIDENCE_BYTES) throw new Error('Documents must be under 5 MB.');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...buf.subarray(0, 5)) !== '%PDF-') throw new Error('That file is not a valid PDF.');
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: 'application/pdf', dataBase64: btoa(bin), previewUrl: '', bytes: file.size, name: file.name };
}

/** Camera capture + gallery/file picker with previews. Images are downscaled on the device (also strips EXIF/GPS). */
export function EvidencePicker({ files, onChange, max = 12, allowPdf = false, label = 'Photos' }: { files: PendingFile[]; onChange: (f: PendingFile[]) => void; max?: number; allowPdf?: boolean; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const latest = useRef(files);
  latest.current = files;
  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const file of [...list]) {
      if (latest.current.length >= max) { toast(`At most ${max} files.`, 'error'); break; }
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf && !allowPdf) throw new Error('Only photos are accepted here.');
        const p = isPdf ? await readPdf(file) : { ...(await compressImage(file)), name: file.name };
        // Read the latest list at append time so overlapping picks (camera + gallery) never overwrite each other.
        const next = [...latest.current, p].slice(0, max);
        latest.current = next;
        onChange(next);
      } catch (e) { toast(`${file.name}: ${(e as Error).message}`, 'error'); }
    }
    setBusy(false);
  }
  return (
    <div>
      <p className="label">{label} <span className="font-normal text-ink-400">({files.length}/{max}, private, staff-only{allowPdf ? ', images or PDF' : ''})</span></p>
      <div className="flex flex-wrap gap-3" data-testid="evidence-previews">
        {files.map((p, i) => (
          <figure key={i} className="relative w-24">
            {p.mime === 'application/pdf'
              ? <div className="grid h-24 w-24 place-items-center rounded-xl bg-silver-50 text-ink-500"><FileText className="h-8 w-8" /></div>
              : <img src={p.previewUrl} alt={`Preview ${i + 1}`} className="h-24 w-24 rounded-xl object-cover" />}
            <figcaption className="mt-1 truncate text-[11px] text-ink-500">{Math.max(1, Math.round(p.bytes / 1024))} KB</figcaption>
            <button type="button" className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-white shadow" aria-label={`Remove file ${i + 1}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-600" /></button>
          </figure>
        ))}
      </div>
      {files.length < max && (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="btn-soft inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-800 hover:bg-teal-100">
            <Camera className="h-4 w-4" /> Take photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} data-testid="evidence-camera" />
          </label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-silver-200 bg-white px-4 text-sm font-semibold text-ink-700 hover:bg-silver-50">
            <ImagePlus className="h-4 w-4" /> {allowPdf ? 'Gallery or files' : 'From gallery'}
            <input type="file" accept={allowPdf ? 'image/jpeg,image/png,image/webp,image/heic,application/pdf' : 'image/jpeg,image/png,image/webp,image/heic'} multiple className="sr-only" disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} data-testid="evidence-gallery" />
          </label>
          {busy && <span className="self-center text-xs text-ink-500">Preparing…</span>}
        </div>
      )}
    </div>
  );
}

/** Uploads one file per request (keeps requests small on mobile networks). Returns how many failed. */
export async function uploadEvidence(path: string, files: PendingFile[], kind: string, caption = '', onProgress?: (done: number) => void) {
  let failed = 0;
  for (const [i, f] of files.entries()) {
    try { await apiPost(path, { kind, mime: f.mime, dataBase64: f.dataBase64, caption }, { auth: 'staff', timeoutMs: 90000 }); } catch { failed++; }
    onProgress?.(i + 1);
  }
  return failed;
}

function Thumb({ row, scope }: { row: EvidenceRow; scope: 'staff' | 'mgmt' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isPdf = row.mime === 'application/pdf';
  useEffect(() => {
    if (row.withheld || isPdf) return;
    let u: string | null = null;
    apiBlobUrl(`/api/${scope}/evidence/${row.evidenceId}/file`, 'staff').then((x) => { u = x; setUrl(x); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [row.evidenceId, row.withheld, isPdf, scope]);
  const openPdf = async () => { const w = window.open('', '_blank'); const x = await apiBlobUrl(`/api/${scope}/evidence/${row.evidenceId}/file`, 'staff').catch(() => null); if (w && x) w.location.href = x; else w?.close(); };
  if (row.withheld) return <div className="grid aspect-square w-full place-items-center rounded-xl bg-silver-50 p-2 text-center text-xs text-ink-500"><Lock className="mb-1 h-5 w-5" />Withheld (Main Admin only)</div>;
  if (isPdf) return <button type="button" onClick={openPdf} className="grid aspect-square w-full place-items-center rounded-xl bg-silver-50 text-ink-600 hover:bg-silver-100"><FileText className="h-8 w-8" /><span className="text-xs">Open PDF</span></button>;
  if (failed) return <div className="grid aspect-square w-full place-items-center rounded-xl bg-silver-50 text-xs text-ink-400">Unavailable</div>;
  if (!url) return <Skeleton className="aspect-square w-full rounded-xl" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={KIND_LABEL[row.kind] ?? row.kind} className="aspect-square w-full rounded-xl object-cover" /></a>;
}

/** Read-only evidence register for an item or handover. Management gets the redacted view and cannot change anything. */
export function EvidenceGallery({ type, id, scope, title = 'Evidence', refreshKey = 0 }: { type: 'found_item' | 'handover'; id: string; scope: 'staff' | 'mgmt'; title?: string; refreshKey?: number }) {
  const { data, error, reload } = useStaffGet<{ rows: EvidenceRow[] }>(`/api/${scope}/evidence?type=${type}&id=${id}`);
  useEffect(() => { if (refreshKey) void reload(); }, [refreshKey, reload]);
  return (
    <Card className="p-4" data-testid={`evidence-${type}`}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-teal-600" /> {title} {data && <span className="font-normal text-ink-400">({data.rows.length})</span>}</h3>
      {error ? <p className="text-sm text-rose-600">{error} <Button size="sm" variant="ghost" onClick={reload}>Retry</Button></p>
        : !data ? <Skeleton className="h-24 w-full" />
        : !data.rows.length ? <p className="text-sm text-ink-500">No files yet.</p>
        : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.rows.map((r) => (
              <li key={r.evidenceId} className="text-xs">
                <Thumb row={r} scope={scope} />
                <p className="mt-1 font-semibold text-ink-700">{KIND_LABEL[r.kind] ?? r.kind}</p>
                <p className="text-ink-500">{r.uploadedBy}</p>
                <p className="text-ink-400">{fmtDate(r.createdAt)} · {Math.max(1, Math.round(r.bytes / 1024))} KB</p>
                {r.caption && <p className="text-ink-500">“{r.caption}”</p>}
                <p className="font-mono text-[10px] text-ink-300" title={`SHA-256 ${r.sha256}`}>{r.evidenceId} · {r.sha256.slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
