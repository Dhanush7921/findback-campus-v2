import { useEffect, useState } from 'react';
import { useToast } from '../../components/toast';
import { Button, Card, ErrorState, Field, Input, Notice, PageHeader, PageSkeleton, Select } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet } from './common';

const LABELS: Record<string, [string, string?]> = {
  collection_office: ['Collection office location'],
  collection_hours: ['Collection hours'],
  contact_email: ['Public contact email'],
  contact_phone: ['Public contact phone'],
  unclaimed_days: ['Days before an item counts as unclaimed', 'number'],
  retention_days: ['Days to keep personal data after closure', 'number'],
  require_two_staff: ['Require a different staff member for handover', 'bool'],
  submissions_open: ['Accept new complaints', 'bool'],
  guest_reports_open: ['Accept guest reports', 'bool'],
};

export default function Settings() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ settings: Record<string, string>; editable: boolean; staffDomain: string; dataEnv: string }>('/api/staff/settings');
  const schema = useStaffGet<{ plan: { table: string; action: string; columns: string[]; detail?: string }[]; dataEnv: string }>('/api/staff/schema');
  const [confirm, setConfirm] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const save = async () => {
    setBusy('save');
    try { await apiPost('/api/staff/settings', { settings: form }, { auth: 'staff' }); toast('Settings saved'); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const migrate = async () => {
    setBusy('migrate');
    try { const r = await apiPost<{ applied: string[]; backupId: string }>('/api/staff/schema/migrate', { confirm }, { auth: 'staff', timeoutMs: 120000 }); toast(`Migration applied (${r.applied.length} changes). Backup: ${r.backupId}`); setConfirm(''); await schema.reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const backup = async () => {
    setBusy('backup');
    try { const r = await apiPost<{ name: string }>('/api/staff/backup', {}, { auth: 'staff', timeoutMs: 90000 }); toast(`Backup created: ${r.name}`); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="System settings" lead={data.editable ? 'Changes apply within a minute.' : 'Read-only: administrator role required to change settings.'} />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="grid gap-5 p-6 sm:grid-cols-2">
          {Object.entries(LABELS).map(([k, [label, type]]) => (
            <Field key={k} label={label} className={type ? '' : 'sm:col-span-2'}>
              {(id) => type === 'bool' ? (
                <Select id={id} value={form[k] ?? ''} disabled={!data.editable} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))}><option value="true">Yes</option><option value="false">No</option></Select>
              ) : (
                <Input id={id} type={type === 'number' ? 'number' : 'text'} min={type === 'number' ? 1 : undefined} value={form[k] ?? ''} disabled={!data.editable} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))} />
              )}
            </Field>
          ))}
          {data.editable && <div className="sm:col-span-2"><Button loading={busy === 'save'} onClick={save}>Save settings</Button></div>}
        </Card>
        <div className="space-y-5">
          <Card className="space-y-3 p-6">
            <h2 className="font-bold">Data store</h2>
            <p className="text-sm text-ink-500">Connected to the <strong>{data.dataEnv}</strong> spreadsheet. Staff roles are managed under Staff & permissions.</p>
            {schema.data && (schema.data.plan.length ? (
              <>
                <Notice tone="warn" title="Schema migration pending">
                  <ul className="mt-1 list-disc pl-4 text-xs">{schema.data.plan.map((p) => <li key={p.table}>{p.action.replace('_', ' ')} {p.table}{p.columns.length ? `: ${p.columns.join(', ')}` : ''}{p.detail ? ` — ${p.detail}` : ''}</li>)}</ul>
                </Notice>
                <p className="text-xs text-ink-500">A full JSON backup is written to the private bucket first. Only new tabs and trailing columns are added; existing rows are never rewritten.</p>
                <Input aria-label="Type MIGRATE to confirm" placeholder="Type MIGRATE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button variant="secondary" disabled={confirm !== 'MIGRATE' || schema.data.plan.some((p) => p.action === 'conflict')} loading={busy === 'migrate'} onClick={migrate}>Back up and migrate</Button>
              </>
            ) : <p className="text-sm text-emerald-700">Schema is up to date.</p>)}
          </Card>
          <Card className="space-y-3 p-6">
            <h2 className="font-bold">Backup</h2>
            <p className="text-sm text-ink-500">Writes a JSON snapshot of every tab to the private Cloud Storage bucket. Create one before bulk changes.</p>
            {data.editable ? <Button variant="secondary" loading={busy === 'backup'} onClick={backup}>Create backup now</Button> : <Notice tone="info">Administrator only.</Notice>}
          </Card>
        </div>
      </div>
    </>
  );
}
