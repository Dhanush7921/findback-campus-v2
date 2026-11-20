import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, apiGet } from '../../lib/api';

export const StaffCtx = createContext<{ email: string; role: 'admin' | 'management' }>({ email: '', role: 'management' });
export const useStaff = () => useContext(StaffCtx);

export function useStaffGet<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<T>(path, { auth: 'staff' }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-silver-100 p-4 text-sm">
      <span className="text-ink-500">Page {page} of {pages} · {total} records</span>
      <div className="flex gap-2">
        <button className="rounded-lg border border-silver-200 px-3 py-1.5 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="rounded-lg border border-silver-200 px-3 py-1.5 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-silver-50 text-xs uppercase tracking-wide text-ink-500">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-silver-100">{children}</tbody>
      </table>
      {empty && <p className="p-8 text-center text-sm text-ink-500">Nothing here yet.</p>}
    </div>
  );
}

export type R = Record<string, string>;
