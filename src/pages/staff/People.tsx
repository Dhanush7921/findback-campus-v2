import { useState } from 'react';
import { useToast } from '../../components/toast';
import { Button, Card, ErrorState, Field, Input, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { Table, useStaff, useStaffGet, type R } from './common';

export default function People() {
  const toast = useToast();
  const me = useStaff();
  const { data, error, reload } = useStaffGet<{ rows: R[]; bootstrapAdmins: string[] }>('/api/staff/roles');
  const [form, setForm] = useState({ email: '', name: '', role: 'management', status: 'active' });
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const save = async (body: Record<string, string>) => {
    setBusy(true);
    try { await apiPost('/api/staff/roles', body, { auth: 'staff' }); toast('Saved'); setForm({ email: '', name: '', role: 'management', status: 'active' }); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Staff & permissions" lead="Main Admin has full operational access. Management can only view statistics, records and audit (enforced on every API call). Changes take effect within 30 seconds." />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <Table head={['Account', 'Role', 'Status', 'Added', '']}>
            {data.bootstrapAdmins.map((e) => (
              <tr key={e}><td className="px-4 py-3">{e}</td><td className="px-4 py-3">Main Admin</td><td className="px-4 py-3"><span className="chip bg-teal-100 text-teal-800">bootstrap</span></td><td className="px-4 py-3 text-xs text-ink-500">Server configuration</td><td /></tr>
            ))}
            {data.rows.map((r) => (
              <tr key={r.email}>
                <td className="px-4 py-3">{r.email}<span className="block text-xs text-ink-500">{r.name}</span></td>
                <td className="px-4 py-3">{r.role === 'admin' ? 'Main Admin' : 'Management'}</td>
                <td className="px-4 py-3"><span className={`chip ${r.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'}`}>{r.status}</span></td>
                <td className="px-4 py-3 text-xs">{fmtDate(r.added_at)}<br />{r.added_by}</td>
                <td className="px-4 py-3 text-right">{r.email !== me.email && <Button size="sm" variant="ghost" loading={busy} onClick={() => save({ email: r.email, role: r.role, name: r.name, status: r.status === 'active' ? 'disabled' : 'active' })}>{r.status === 'active' ? 'Disable' : 'Enable'}</Button>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card className="space-y-4 p-6">
          <h2 className="font-bold">Add or change a staff account</h2>
          <Field label="Google account email" required>{(fid) => <Input id={fid} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Name" optionalLabel="optional">{(fid) => <Input id={fid} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Role">{(fid) => <Select id={fid} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="management">Management (read-only monitoring)</option><option value="admin">Main Admin (full access)</option></Select>}</Field>
          <Button className="w-full" disabled={!form.email.includes('@')} loading={busy} onClick={() => save(form)}>Save account</Button>
        </Card>
      </div>
    </>
  );
}
