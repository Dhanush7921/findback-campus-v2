import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { COMPLAINT_STATUSES } from '../../../shared/domain';
import { StatusBadge } from '../../components/status';
import { COMPLAINT_FIELDS, EditModal } from '../../components/EditForms';
import { Button, Card, ErrorState, Input, PageHeader, Select, Skeleton, fmtDate } from '../../components/ui';
import { apiPost } from '../../lib/api';
import { Pager, Table, useStaffGet, type R } from './common';

export default function Complaints() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const params = new URLSearchParams({ status, q: query, page: String(page) });
  const { data, error, loading, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/staff/complaints?${params}`);
  return (
    <>
      <PageHeader title="Complaint management" lead="Search by exact Complaint ID (FB-…) or student ID." actions={<Button size="sm" onClick={() => setCreating(true)}>New complaint</Button>} />
      {creating && <EditModal open title="Enter a complaint for a walk-in reporter" reason note="Staff-entered complaints are marked unverified. For receiver-confirmed handover, the owner must also sign in through the Student or Guest portal." fields={[{ key: 'reporterName', label: 'Reporter name', required: true, max: 80 }, { key: 'reporterContact', label: 'Contact (optional)', max: 60 }, { key: 'studentId', label: 'Student ID (optional)', max: 30 }, ...COMPLAINT_FIELDS, { key: 'ownershipEvidence', label: 'Private ownership evidence', type: 'textarea', required: true, max: 1000 }]} initial={{ lostDate: new Date().toISOString().slice(0, 10) }} onClose={() => setCreating(false)} onSave={async (v) => { const r = await apiPost<{ complaintId: string }>('/api/staff/complaints', v, { auth: 'staff' }); nav(`/staff/complaints/${r.complaintId}`); }} />}
      <form className="mb-5 flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(1); }}>
        <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-ink-400" /><Input aria-label="Search" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="FB-XXXX-XXXX or student ID" /></div>
        <Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{COMPLAINT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
      </form>
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <div className="space-y-2 p-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <>
            <Table head={['Complaint', 'Item', 'Student ID', 'Lost', 'Status', 'Updated']} empty={!data?.rows.length}>
              {data?.rows.map((c) => (
                <tr key={c.complaint_id} className="hover:bg-teal-50/30">
                  <td className="px-4 py-3"><Link className="font-mono font-semibold text-teal-700 hover:underline" to={c.complaint_id}>{c.complaint_id}</Link></td>
                  <td className="px-4 py-3"><p className="font-medium">{c.item_name}</p><p className="text-xs text-ink-500">{c.category}</p></td>
                  <td className="px-4 py-3">{c.student_id}</td>
                  <td className="px-4 py-3 text-ink-500">{fmtDate(c.lost_date, false)}<p className="text-xs">{c.last_seen_location}</p></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} translate={false} /></td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmtDate(c.updated_at)}</td>
                </tr>
              ))}
            </Table>
            {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
