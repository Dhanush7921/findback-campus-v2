import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, PageSkeleton, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { Table, useStaffGet, type R } from './common';

export default function Unclaimed() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ rows: R[]; total: number; days: number }>('/api/staff/unclaimed');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const act = async (id: string, status: string) => {
    setBusy(id + status);
    try { await apiPost(`/api/staff/found-items/${id}/status`, { status, note: notes[id] ?? '' }, { auth: 'staff' }); toast(`Marked ${status}`); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="Unclaimed items" lead={`Items in storage for more than ${data.days} days (change in Settings). Record a note before donating or disposing.`} />
      <Card className="overflow-hidden">
        {!data.rows.length ? <EmptyState title="No long-unclaimed items" /> : (
          <Table head={['Item', 'Found', 'Storage', 'Disposal note', '']}>
            {data.rows.map((i) => (
              <tr key={i.item_id}>
                <td className="px-4 py-3"><Link className="font-mono text-teal-700 hover:underline" to={`/staff/inventory/${i.item_id}`}>{i.item_id}</Link><p>{i.item_name}</p></td>
                <td className="px-4 py-3 text-xs">{fmtDate(i.found_date, false)}<br />{i.found_location}</td>
                <td className="px-4 py-3 text-xs">{i.storage_location}</td>
                <td className="px-4 py-3"><Input aria-label="Disposal note" className="!min-h-[40px] !py-2" value={notes[i.item_id] ?? ''} onChange={(e) => setNotes((s) => ({ ...s, [i.item_id]: e.target.value }))} /></td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                  <Button size="sm" variant="soft" loading={busy === i.item_id + 'Donated'} disabled={(notes[i.item_id] ?? '').length < 3} onClick={() => act(i.item_id, 'Donated')}>Donate</Button>
                  <Button size="sm" variant="secondary" loading={busy === i.item_id + 'Disposed'} disabled={(notes[i.item_id] ?? '').length < 3} onClick={() => act(i.item_id, 'Disposed')}>Dispose</Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
