import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Field, Input, Notice, PageHeader, PageSkeleton, Select, Textarea, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet, type R } from './common';
import { StaffImage } from './StaffImage';

type Row = { claim: R; complaint: R | null; item: R | null };

function ClaimCard({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const [checks, setChecks] = useState({ evidenceMatches: false, featuresMatch: false, noConflictingClaims: false });
  const [notes, setNotes] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { claim, complaint: c, item: i } = row;
  const decide = async (decision: 'approve' | 'reject' | 'dispute') => {
    setBusy(decision);
    try {
      await apiPost(`/api/staff/claims/${claim.claim_id}/decision`, { decision, notes, checks, collectionInstructions: instructions }, { auth: 'staff' });
      toast(decision === 'approve' ? 'Claim approved — reporter notified' : decision === 'dispute' ? 'Marked as disputed' : 'Claim rejected — reporter notified');
      onDone();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const all = checks.evidenceMatches && checks.featuresMatch && checks.noConflictingClaims;
  const pending = claim.status === 'Pending' || claim.status === 'Disputed';
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold"><span className="font-mono">{claim.claim_id}</span></h2><span className="text-xs text-ink-500">{fmtDate(claim.created_at)} · {claim.status}</span></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-silver-50 p-4 text-sm">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Student’s claim</p>
          {c && <p className="mb-2"><Link className="font-mono text-teal-700 hover:underline" to={`/staff/complaints/${c.complaint_id}`}>{c.complaint_id}</Link> · {c.name} ({c.student_id})</p>}
          <p><strong>Claim evidence:</strong> {claim.evidence}</p>
          {c && <p className="mt-2"><strong>Original evidence:</strong> {c.ownership_evidence}</p>}
          {c && <p className="mt-2 text-ink-500">{c.description} · {c.color_features}</p>}
        </div>
        <div className="rounded-2xl bg-teal-50/60 p-4 text-sm">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Found item (private)</p>
          {i && <p className="mb-2"><Link className="font-mono text-teal-700 hover:underline" to={`/staff/inventory/${i.item_id}`}>{i.item_id}</Link> · {i.item_name} · {i.storage_location}</p>}
          {i && <p><strong>Private details:</strong> {i.private_details || '—'}</p>}
          {i && <p className="mt-2 text-ink-500">{i.public_description} · {i.color_features}</p>}
          {i?.photo_file_ids && <div className="mt-3 flex gap-2">{i.photo_file_ids.split(',').filter(Boolean).map((p) => <StaffImage key={p} fileId={p} alt="" className="h-20 w-20 rounded-lg" />)}</div>}
        </div>
      </div>
      {pending && (
        <div className="mt-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="label">Verification checklist (all required to approve)</legend>
            {([['evidenceMatches', 'Claim evidence matches private details recorded for the item'], ['featuresMatch', 'Described colour/features match the physical item'], ['noConflictingClaims', 'No conflicting claim or reason for doubt']] as const).map(([k, label]) => (
              <label key={k} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={checks[k]} onChange={(e) => setChecks((s) => ({ ...s, [k]: e.target.checked }))} /> {label}</label>
            ))}
          </fieldset>
          <Field label="Decision notes" required>{(fid) => <Textarea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[70px]" />}</Field>
          <Field label="Collection instructions" optionalLabel="optional — default uses office & hours">{(fid) => <Input id={fid} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!all || notes.trim().length < 3} loading={busy === 'approve'} onClick={() => decide('approve')}>Approve claim</Button>
            <Button variant="secondary" disabled={notes.trim().length < 3} loading={busy === 'reject'} onClick={() => decide('reject')}>Reject</Button>
            {claim.status !== 'Disputed' && <Button variant="ghost" disabled={notes.trim().length < 3} loading={busy === 'dispute'} onClick={() => decide('dispute')}>Mark disputed</Button>}
          </div>
        </div>
      )}
      {!pending && claim.decision_notes && <Notice tone="info" className="mt-4">{claim.reviewed_by}: {claim.decision_notes}</Notice>}
    </Card>
  );
}

export default function Claims() {
  const [status, setStatus] = useState('Pending');
  const { data, error, reload } = useStaffGet<{ rows: Row[] }>(`/api/staff/claims?status=${status}`);
  return (
    <>
      <PageHeader title="Claim verification" lead="Compare the reporter’s evidence with the item’s private details. Items are released only after approval and a receiver-confirmed handover." actions={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto"><option>Pending</option><option>Disputed</option><option>Approved</option><option>Rejected</option><option>Completed</option></Select>} />
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : !data.rows.length ? <Card><EmptyState title="No claims here" /></Card> : (
        <div className="space-y-5">{data.rows.map((r) => <ClaimCard key={r.claim.claim_id} row={r} onDone={reload} />)}</div>
      )}
    </>
  );
}
