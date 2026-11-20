import { useState } from 'react';
import { StatusBadge } from '../../components/status';
import { Card, ErrorState, Modal, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { Pager, Table, useStaffGet, type R } from '../staff/common';
import { ExportButton } from './shared';

const STATUSES = ['', 'Submitted', 'Under Review', 'Potential Match', 'Ownership Verification', 'Ready for Collection', 'Awaiting Receiver Confirmation', 'Returned', 'Closed', 'Rejected', 'Cancelled', 'Disputed', 'Unclaimed'];

export function MgmtComplaints() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/mgmt/complaints?page=${page}&status=${encodeURIComponent(status)}&type=${type}`);
  const detail = useStaffGet<{ complaint: R; timeline: R[]; handovers: R[] }>(open ? `/api/mgmt/complaints/${open}` : null);
  return (
    <>
      <PageHeader title="Complaints (read-only)" lead="Who reported what, and where each case stands. Contact details and ownership evidence are not shown to management." actions={
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}</Select>
          <Select aria-label="Reporter type" className="!w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">Students & guests</option><option>Student</option><option>Guest</option></Select>
          <ExportButton type="complaints" qs="" />
        </div>
      } />
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
          <>
            <Table head={['Complaint', 'Reported by', 'Item', 'Status', 'Submitted']} empty={!data.rows.length}>
              {data.rows.map((c) => (
                <tr key={c.complaint_id} className="cursor-pointer hover:bg-silver-50" onClick={() => setOpen(c.complaint_id)}>
                  <td className="px-4 py-3 font-mono text-teal-700">{c.complaint_id}</td>
                  <td className="px-4 py-3">{c.name}<span className="block text-xs text-ink-500">{c.reporter_type}{c.student_id ? ` · ${c.student_id}` : ''}{c.department ? ` · ${c.department}` : ''}</span></td>
                  <td className="px-4 py-3">{c.item_name}<span className="block text-xs text-ink-500">{c.category} · {c.last_seen_location}</span></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} translate={false} /></td>
                  <td className="px-4 py-3 text-xs">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ?? ''}>
        {!detail.data ? <PageSkeleton /> : (
          <div className="space-y-4 text-sm">
            <p><strong>{detail.data.complaint.item_name}</strong> · {detail.data.complaint.category}<br />Reported by {detail.data.complaint.name} ({detail.data.complaint.reporter_type}{detail.data.complaint.student_id ? `, ${detail.data.complaint.student_id}` : ''}) · phone {detail.data.complaint.phone}</p>
            <ol className="space-y-2 border-l-2 border-teal-100 pl-4">{detail.data.timeline.map((e, i) => <li key={i}><StatusBadge status={e.status} translate={false} /> <span className="text-xs text-ink-500">{fmtDate(e.at)} · {e.actor}</span></li>)}</ol>
            {detail.data.handovers.map((h) => <p key={h.handoverId} className="rounded-xl bg-silver-50 p-3 text-xs">Handover {h.handoverId} · {h.status} · receiver {h.receiverName} ({h.receiverType}) · approved by {h.approvedBy} · released by {h.releasedBy || '—'} {h.releasedAt ? `on ${fmtDate(h.releasedAt)}` : ''}</p>)}
          </div>
        )}
      </Modal>
    </>
  );
}

export function MgmtFound() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, error, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/mgmt/found-items?page=${page}&status=${encodeURIComponent(status)}`);
  return (
    <>
      <PageHeader title="Registered found items" lead="Public details only. ID numbers are masked; private identifying details and storage locations are visible to Main Admin only." actions={
        <div className="flex gap-2"><Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{['', 'In Storage', 'Matched', 'Claimed', 'Returned', 'Donated', 'Disposed'].map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}</Select><ExportButton type="found" qs="" label="Export" /></div>
      } />
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
          <>
            <Table head={['Item', 'Description', 'Found', 'Registered by', 'Status']} empty={!data.rows.length}>
              {data.rows.map((f) => (
                <tr key={f.itemId}>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{f.itemId}</span><span className="block font-medium">{f.itemName}</span><span className="text-xs text-ink-500">{f.category}</span></td>
                  <td className="px-4 py-3 text-xs text-ink-700">{f.description}</td>
                  <td className="px-4 py-3 text-xs">{f.foundLocation}<br />{fmtDate(f.foundDate, false)}</td>
                  <td className="px-4 py-3 text-xs">{f.registeredBy}</td>
                  <td className="px-4 py-3"><StatusBadge status={f.status} translate={false} /></td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export function MgmtHandovers() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useStaffGet<{ rows: R[] }>(`/api/mgmt/handovers?status=${encodeURIComponent(status)}`);
  return (
    <>
      <PageHeader title="Handovers" lead="Pending and completed receiver-confirmed handovers, with the approving and releasing staff." actions={
        <div className="flex gap-2"><Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>{['', 'Pending Acknowledgment', 'Acknowledged', 'Released', 'Cancelled', 'Expired'].map((s) => <option key={s} value={s}>{s || 'All'}</option>)}</Select><ExportButton type="handovers" qs="" label="Export" /></div>
      } />
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
          <Table head={['Handover', 'Complaint / item', 'Receiver', 'Approved / released by', 'Confirmed / released', 'Status']} empty={!data.rows.length}>
            {data.rows.map((h) => (
              <tr key={h.handoverId}>
                <td className="px-4 py-3 font-mono text-xs">{h.handoverId}</td>
                <td className="px-4 py-3 font-mono text-xs">{h.complaintId}<br />{h.itemId}</td>
                <td className="px-4 py-3">{h.receiverName}<span className="block text-xs text-ink-500">{h.receiverType}</span></td>
                <td className="px-4 py-3 text-xs">{h.approvedBy}<br />{h.releasedBy || '—'}</td>
                <td className="px-4 py-3 text-xs">{fmtDate(h.acknowledgedAt)}<br />{fmtDate(h.releasedAt)}</td>
                <td className="px-4 py-3"><StatusBadge status={h.status} translate={false} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
