import { Upload } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { Button, Card, ErrorState, Field, Input, Modal, Notice, PageHeader, PageSkeleton, Select, Textarea, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { Pager, Table, useStaffGet, type R } from './common';

/** Minimal CSV parser (quoted fields supported). Header: student_id,name,department,year,phone,email,status */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(cell); rows.push(cur); cur = []; cell = ''; }
    else cell += ch;
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export default function Registry() {
  const toast = useToast();
  const [tab, setTab] = useState<'students' | 'guests'>('students');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const students = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(tab === 'students' ? `/api/staff/registry?page=${page}&q=${encodeURIComponent(search)}` : null);
  const guests = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(tab === 'guests' ? `/api/staff/guests?page=${page}` : null);
  const [importOpen, setImportOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [source, setSource] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number; unchanged: number; errors: { row: number; error: string }[] } | null>(null);
  const [edit, setEdit] = useState<R | null>(null);
  const [editForm, setEditForm] = useState({ phone: '', status: '', note: '' });
  const [busy, setBusy] = useState(false);
  const runImport = async () => {
    setBusy(true);
    try {
      let agg = { added: 0, updated: 0, unchanged: 0, errors: [] as { row: number; error: string }[] };
      for (let i = 0; i < rows.length; i += 500) {
        const r = await apiPost<typeof agg>('/api/staff/registry/import', { source, rows: rows.slice(i, i + 500).map((x) => ({ studentId: x.student_id, name: x.name, department: x.department, year: x.year ?? '', phone: x.phone, email: x.email ?? '', status: x.status || 'active' })) }, { auth: 'staff', timeoutMs: 120000 });
        agg = { added: agg.added + r.added, updated: agg.updated + r.updated, unchanged: agg.unchanged + r.unchanged, errors: [...agg.errors, ...r.errors.map((e) => ({ ...e, row: e.row + i }))] };
      }
      setResult(agg);
      await students.reload();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  const list = tab === 'students' ? students : guests;
  return (
    <>
      <PageHeader title="Student registry & guests" lead="The approved student registry is the only source of student eligibility. Phone corrections require in-person verification and sign the student out everywhere." actions={tab === 'students' && <Button onClick={() => { setImportOpen(true); setRows([]); setResult(null); }}><Upload className="h-4 w-4" /> Import registry CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['students', 'guests'] as const).map((t) => <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === t ? 'brand-gradient text-white' : 'bg-white text-ink-600 ring-1 ring-silver-200'}`}>{t === 'students' ? 'Registered students' : 'Guest accounts'}</button>)}
        {tab === 'students' && <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(1); }}><Input className="!min-h-0 !py-2" placeholder="Student ID or phone" value={q} onChange={(e) => setQ(e.target.value)} /><Button size="sm" variant="secondary" type="submit">Search</Button></form>}
      </div>
      <Card className="overflow-hidden">
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <PageSkeleton /> : tab === 'students' ? (
          <>
            <Table head={['Student', 'Department', 'Registered phone', 'Status', 'Updated', '']} empty={!list.data.rows.length}>
              {list.data.rows.map((s) => (
                <tr key={s.student_id}>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{s.student_id}</span><span className="block font-medium">{s.name}</span></td>
                  <td className="px-4 py-3 text-xs">{s.department} {s.year}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.phone}</td>
                  <td className="px-4 py-3"><span className={`chip ${s.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'}`}>{s.status}</span></td>
                  <td className="px-4 py-3 text-xs">{fmtDate(s.updated_at)}<br />{s.updated_by}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => { setEdit(s); setEditForm({ phone: s.phone, status: s.status, note: '' }); }}>Update identity</Button></td>
                </tr>
              ))}
            </Table>
            <Pager page={list.data.page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
          </>
        ) : (
          <>
            <Table head={['Guest', 'Verified phone', 'First seen', 'Last sign-in', 'Status', '']} empty={!list.data.rows.length}>
              {list.data.rows.map((g) => (
                <tr key={g.uid}>
                  <td className="px-4 py-3">{g.name || '—'}<span className="block break-all font-mono text-[10px] text-ink-400">{g.uid}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{g.phone}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(g.created_at)}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(g.last_login_at)}</td>
                  <td className="px-4 py-3"><span className={`chip ${g.status === 'blocked' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'}`}>{g.status}</span></td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={async () => { const note = window.prompt(g.status === 'blocked' ? 'Reason for unblocking?' : 'Reason for blocking this guest?'); if (!note) return; try { await apiPost(`/api/staff/guests/${encodeURIComponent(g.uid)}/status`, { status: g.status === 'blocked' ? 'active' : 'blocked', note }, { auth: 'staff' }); toast('Guest updated'); await guests.reload(); } catch (e) { toast((e as ApiError).message, 'error'); } }}>{g.status === 'blocked' ? 'Unblock' : 'Block'}</Button></td>
                </tr>
              ))}
            </Table>
            <Pager page={list.data.page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import student registry">
        <div className="space-y-4 text-sm">
          <p className="text-ink-600">Upload the college-approved CSV with columns <code>student_id, name, department, year, phone, email, status</code>. Existing students are updated by student_id; nothing is deleted. Phones may be 10-digit Indian numbers or +country format.</p>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRows(parseCsv(await f.text())); }} />
          {!!rows.length && <p className="font-semibold">{rows.length} rows ready</p>}
          <Field label="Authorised source of this data" hint="e.g. 'Registrar office export, 20 Nov 2026, approved by Principal'" required>{(fid, d) => <Input id={fid} aria-describedby={d} value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} />}</Field>
          <Button className="w-full" disabled={!rows.length || source.trim().length < 5} loading={busy} onClick={runImport}>Import</Button>
          {result && <Notice tone={result.errors.length ? 'warn' : 'success'} title={`Added ${result.added}, updated ${result.updated}, unchanged ${result.unchanged}`}>{!!result.errors.length && <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4 text-xs">{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}</Notice>}
        </div>
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Update ${edit?.student_id ?? ''}`}>
        <div className="space-y-4">
          <Notice tone="warn">Use this for lost phones or number changes. Verify the student in person with their college ID first. All sessions for this student are revoked.</Notice>
          <Field label="Registered mobile number">{(fid) => <Input id={fid} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />}</Field>
          <Field label="Status">{(fid) => <Select id={fid} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}><option value="active">active</option><option value="inactive">inactive</option></Select>}</Field>
          <Field label="How was identity verified?" required>{(fid) => <Textarea id={fid} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />}</Field>
          <Button className="w-full" disabled={editForm.note.trim().length < 10} loading={busy} onClick={async () => {
            if (!edit) return;
            setBusy(true);
            try { await apiPost(`/api/staff/registry/${encodeURIComponent(edit.student_id)}`, { phone: editForm.phone !== edit.phone ? editForm.phone : undefined, status: editForm.status !== edit.status ? editForm.status : undefined, note: editForm.note }, { auth: 'staff' }); toast('Identity updated'); setEdit(null); await students.reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
          }}>Save and revoke sessions</Button>
        </div>
      </Modal>
    </>
  );
}
