import { useState } from 'react';
import { Card, ErrorState, PageHeader, PageSkeleton, Select, fmtDate } from '../../components/ui';
import { Pager, Table, useStaffGet, type R } from '../staff/common';

/** Shared audit trail view. Management gets the redacted /api/mgmt/audit feed; Main Admin the full log. */
export default function Audit({ source = 'mgmt' }: { source?: 'mgmt' | 'staff' }) {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const path = source === 'mgmt' ? '/api/mgmt/audit' : '/api/staff/activity';
  const { data, error, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`${path}?page=${page}&entity=${entity}`);
  return (
    <>
      <PageHeader title="Audit trail" lead={source === 'mgmt' ? 'Every administrative action is recorded and cannot be edited from the application. Identity-sensitive details are restricted.' : 'Complete, append-only record of every action, including sign-ins.'} actions={
        <Select aria-label="Entity" className="!w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>{['', 'Complaint', 'FoundItem', 'Claim', 'Handover', 'Registry', 'Guest', 'Staff', 'Settings', 'Report', 'Auth'].map((s) => <option key={s} value={s}>{s || 'All records'}</option>)}</Select>
      } />
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <PageSkeleton /> : (
          <>
            <Table head={['When', 'Actor', 'Action', 'Record', 'Details']} empty={!data.rows.length}>
              {data.rows.map((r) => (
                <tr key={r.log_id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-xs">{r.actor}<span className="block text-ink-400">{r.role}</span></td>
                  <td className="px-4 py-3 font-medium">{r.action.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.entity} {r.entity_id}</td>
                  <td className="max-w-xs px-4 py-3 text-xs text-ink-600">{r.details}</td>
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
