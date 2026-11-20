import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiConfigured, apiGet } from './api';

export interface FirebaseWebConfig { apiKey: string; authDomain: string; projectId: string; appId: string }
export interface PublicConfig {
  collectionOffice: string;
  collectionHours: string;
  contactEmail: string;
  contactPhone: string;
  submissionsOpen: boolean;
  guestReportsOpen: boolean;
  auth: { enabled: boolean; devAuth: boolean; firebase: FirebaseWebConfig | null; staffDomain: string };
  environment: 'production' | 'staging' | 'development';
  degraded?: boolean;
}
interface State { config: PublicConfig | null; status: 'loading' | 'ready' | 'offline' | 'unconfigured' }
const Ctx = createContext<State>({ config: null, status: 'loading' });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({ config: null, status: apiConfigured() ? 'loading' : 'unconfigured' }));
  const [rev, setRev] = useState(0);
  useEffect(() => {
    // Entering or leaving demo mode switches the data source, so reload the public config.
    const on = () => setRev((r) => r + 1);
    window.addEventListener('fb-demo', on);
    return () => window.removeEventListener('fb-demo', on);
  }, []);
  useEffect(() => {
    if (!apiConfigured()) { setState({ config: null, status: 'unconfigured' }); return; }
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    apiGet<PublicConfig>('/api/public/config', { retries: 2 })
      .then((config) => live && setState({ config, status: 'ready' }))
      .catch(() => live && setState({ config: null, status: 'offline' }));
    return () => { live = false; };
  }, [rev]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
export const useConfig = () => useContext(Ctx);
