import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, apiGet } from '../../lib/api';

export interface Profile { type: 'Student' | 'Guest'; name: string; studentId?: string; department?: string; phone: string }
export const MeCtx = createContext<{ profile: Profile; expiresAt: number; signOut: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;

export function useMeGet<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    setError(null);
    try { setData(await apiGet<T>(path, { auth: 'reporter' })); } catch (e) { setError((e as ApiError).message); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}
