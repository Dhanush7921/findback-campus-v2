import { useState } from 'react';
import { CATEGORIES } from '../../shared/domain';
import { ApiError } from '../lib/api';
import { useToast } from './toast';
import { Button, Field, Input, Modal, Notice, Select, Textarea } from './ui';

export interface FieldDef { key: string; label: string; type?: 'text' | 'textarea' | 'date' | 'time' | 'category'; required?: boolean; hint?: string; max?: number }

export const COMPLAINT_FIELDS: FieldDef[] = [
  { key: 'category', label: 'Category', type: 'category', required: true },
  { key: 'itemName', label: 'Item name', required: true, max: 80 },
  { key: 'description', label: 'Description', type: 'textarea', required: true, max: 1000 },
  { key: 'colorFeatures', label: 'Colour & distinguishing features', required: true, max: 300 },
  { key: 'lastSeenLocation', label: 'Last seen location', required: true, max: 160 },
  { key: 'lostDate', label: 'Date lost', type: 'date', required: true },
  { key: 'lostTime', label: 'Approximate time', type: 'time' },
];
export const FOUND_FIELDS: FieldDef[] = [
  { key: 'category', label: 'Category', type: 'category', required: true },
  { key: 'itemName', label: 'Item name', required: true, max: 80 },
  { key: 'publicDescription', label: 'Public description', type: 'textarea', required: true, max: 500 },
  { key: 'privateDetails', label: 'Private verification details', type: 'textarea', max: 1000 },
  { key: 'colorFeatures', label: 'Colour & features', required: true, max: 300 },
  { key: 'foundLocation', label: 'Found location', required: true, max: 160 },
  { key: 'foundDate', label: 'Found date', type: 'date', required: true },
  { key: 'foundTime', label: 'Found time', type: 'time' },
  { key: 'storageLocation', label: 'Storage location', required: true, max: 120 },
];

/**
 * Prefilled Edit modal with Save / Cancel and server-side validation messages.
 * With `reason`, a short reason is required and recorded in the audit history.
 */
export function EditModal({ open, title, fields, initial, reason = false, note, onSave, onClose }: {
  open: boolean; title: string; fields: FieldDef[]; initial: Record<string, string>; reason?: boolean; note?: string;
  onSave: (values: Record<string, string>) => Promise<unknown>; onClose: () => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  async function save() {
    const errs: Record<string, string> = {};
    for (const f of fields) if (f.required && !(v[f.key] ?? '').trim()) errs[f.key] = 'Required';
    if (reason && (v.reason ?? '').trim().length < 3) errs.reason = 'Give a short reason for the audit history';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await onSave(v);
      toast('Saved');
      onClose();
    } catch (e) {
      const ae = e as ApiError;
      if (ae.details) setErrors(ae.details);
      toast(ae.message, 'error');
    } finally { setBusy(false); }
  }
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4" data-testid="edit-modal">
        {note && <Notice tone="info">{note}</Notice>}
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} optionalLabel="optional" error={errors[f.key]} hint={f.hint}>
            {(id) => f.type === 'category' ? <Select id={id} value={v[f.key] ?? ''} onChange={set(f.key)} invalid={!!errors[f.key]}><option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
              : f.type === 'textarea' ? <Textarea id={id} value={v[f.key] ?? ''} maxLength={f.max} onChange={set(f.key)} invalid={!!errors[f.key]} />
              : <Input id={id} type={f.type ?? 'text'} max={f.type === 'date' ? today : undefined} value={v[f.key] ?? ''} maxLength={f.max} onChange={set(f.key)} invalid={!!errors[f.key]} />}
          </Field>
        ))}
        {reason && <Field label="Reason for this change" required error={errors.reason} hint="Recorded with your name in the audit history.">{(id) => <Input id={id} value={v.reason ?? ''} maxLength={300} onChange={set('reason')} invalid={!!errors.reason} />}</Field>}
        <div className="flex gap-2">
          <Button onClick={save} loading={busy}>Save</Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Small confirm-with-reason dialog for destructive/archive actions. */
export function ConfirmReason({ open, title, text, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; text: string; confirmLabel: string; onConfirm: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <Notice tone="warn">{text}</Notice>
        <Field label="Reason" required>{(id) => <Input id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="flex gap-2">
          <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); setReason(''); onClose(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); } }}>{confirmLabel}</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
