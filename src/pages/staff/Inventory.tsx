import { useState } from 'react';
import { Link } from 'react-router';
import { CATEGORIES, FOUND_ITEM_STATUSES } from '../../../shared/domain';
import { EmptyBoxArt } from '../../components/art';
import { StatusBadge } from '../../components/status';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, fmtDate } from '../../components/ui';
import { Pager, useStaffGet, type R } from './common';

export default function Inventory() {
  const [status, setStatus] = useState('In Storage');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ status, category, page: String(page) });
  const { data, error, loading, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/staff/found-items?${q}`);
  return (
    <>
      <PageHeader title="Found item inventory" actions={<ButtonLink to="/staff/register">Register item</ButtonLink>} />
      <div className="mb-5 flex flex-wrap gap-3">
        <Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{FOUND_ITEM_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select aria-label="Category" className="!w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">All categories</option>{CATEGORIES.map((s) => <option key={s}>{s}</option>)}</Select>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : !data?.rows.length ? <Card><EmptyState art={<EmptyBoxArt />} title="No items match these filters" /></Card> : (
        <Card className="overflow-hidden">
          <div className="grid gap-px bg-silver-100 sm:grid-cols-2 lg:grid-cols-3">
            {data.rows.map((i) => (
              <Link key={i.item_id} to={i.item_id} className="bg-white p-5 transition hover:bg-teal-50/40">
                <div className="flex items-start justify-between gap-2"><span className="font-mono text-xs text-ink-400">{i.item_id}</span><StatusBadge status={i.status} /></div>
                <p className="mt-2 font-bold">{i.item_name}</p>
                <p className="text-xs text-teal-700">{i.category}</p>
                <p className="mt-2 line-clamp-2 text-sm text-ink-500">{i.public_description}</p>
                <p className="mt-3 text-xs text-ink-400">Found {fmtDate(i.found_date, false)} · {i.found_location} · {i.storage_location}</p>
              </Link>
            ))}
          </div>
          <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </Card>
      )}
    </>
  );
}
