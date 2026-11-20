import { LogOut, Menu, ShieldAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../../components/art';
import { useToast } from '../../components/toast';
import { Button, ButtonLink, Card, Notice, PageSkeleton } from '../../components/ui';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { firebaseSignOut, googleIdToken } from '../../lib/auth';
import { useConfig } from '../../lib/config';
import { clearSession, getSession, saveSession } from '../../lib/session';
import { StaffCtx } from './common';

function SignIn({ title, onDone }: { title: string; onDone: () => void }) {
  const { config } = useConfig();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState('dev.admin@example.edu');
  const go = async () => {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await googleIdToken(config, devEmail);
      const r = await apiPost<{ token: string; expiresAt: number; email: string; role: string; name: string }>('/api/staff/session', { idToken });
      saveSession('staff', r.token, r.expiresAt, { email: r.email, role: r.role, name: r.name });
      onDone();
    } catch (e) {
      setError((e as ApiError | Error).message);
      void firebaseSignOut();
    } finally { setBusy(false); }
  };
  const dev = config?.auth.devAuth && !config.auth.firebase;
  return (
    <div className="grid min-h-dvh place-items-center safe-x">
      <Card className="w-full max-w-md p-8 text-center animate-rise">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">Sign in with your authorised {config?.auth.staffDomain ? `@${config.auth.staffDomain} ` : ''}Google account. Your role is checked on the server for every request.</p>
        {dev && <input className="input mt-5" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} aria-label="Development email" />}
        <Button className="mt-6 w-full" size="lg" loading={busy} onClick={go}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" /><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" /><path fill="#fff" opacity=".7" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" /><path fill="#fff" opacity=".55" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" /></svg>
          {dev ? 'Development sign-in' : 'Sign in with Google'}
        </Button>
        {error && <Notice tone="error" className="mt-5 text-left">{error}</Notice>}
        <Link to="/" className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline">← Back to FindBack</Link>
      </Card>
    </div>
  );
}

export interface NavItem { to: string; label: string; icon: LucideIcon }

/** Shared shell for the Main Admin and Management consoles. Role is enforced by the API; this only routes. */
export default function Console({ kind, base, nav, title }: { kind: 'admin' | 'management'; base: string; nav: NavItem[]; title: string }) {
  const { config, status } = useConfig();
  const toast = useToast();
  const loc = useLocation();
  const [session, setSession] = useState(() => getSession('staff'));
  const [verified, setVerified] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const on = () => setSession(getSession('staff'));
    window.addEventListener('fb-session', on);
    return () => window.removeEventListener('fb-session', on);
  }, []);
  useEffect(() => {
    if (!session) { setVerified(null); return; }
    apiGet<{ email: string; role: string }>('/api/staff/me', { auth: 'staff' })
      .then((r) => setVerified(r.role))
      .catch((e: ApiError) => { if (e.status !== 401) toast(e.message, 'error'); clearSession('staff'); });
  }, [session, toast]);

  if (status === 'loading') return <PageSkeleton />;
  if (!config?.auth.enabled) {
    return (
      <div className="grid min-h-dvh place-items-center safe-x">
        <Card className="max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ShieldAlert className="h-7 w-7" /></div>
          <h1 className="text-2xl font-extrabold">Staff access is not available</h1>
          <p className="mt-2 text-sm text-ink-500">{status === 'ready' ? 'Staff sign-in is disabled until the server’s identity provider is configured.' : 'The FindBack service could not be reached right now.'}</p>
          <ButtonLink to="/" variant="secondary" className="mt-6">Back to FindBack</ButtonLink>
        </Card>
      </div>
    );
  }
  if (!session) return <SignIn title={title} onDone={() => setSession(getSession('staff'))} />;
  if (!verified) return <PageSkeleton />;
  if (kind === 'admin' && verified === 'management') return <Navigate to="/management" replace />;

  const email = session.meta?.email ?? '';
  const role = verified as 'admin' | 'management';
  const signOut = () => { clearSession('staff'); void firebaseSignOut(); };
  const sidebar = (
    <nav className="flex flex-col gap-0.5" aria-label={title}>
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to ? `${base}/${to}` : base} end={to === ''} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-800 ring-1 ring-teal-100' : 'text-ink-500 hover:bg-silver-50 hover:text-ink-900'}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden /> {label}
        </NavLink>
      ))}
      {role === 'admin' && kind === 'admin' && <NavLink to="/management" className="mt-4 rounded-xl px-3 py-2 text-xs font-semibold text-ink-400 hover:text-teal-700">Open management view →</NavLink>}
      {role === 'admin' && kind === 'management' && <NavLink to="/staff" className="mt-4 rounded-xl px-3 py-2 text-xs font-semibold text-ink-400 hover:text-teal-700">← Back to Main Admin</NavLink>}
    </nav>
  );
  return (
    <StaffCtx.Provider value={{ email, role }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
        <aside className="glass hidden border-y-0 border-l-0 p-5 lg:block">
          <Link to={base} className="mb-8 block"><Logo /></Link>
          {sidebar}
        </aside>
        <div className="min-w-0">
          <header className="glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-x-0 border-t-0 safe-x" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <button className="grid h-11 w-11 place-items-center rounded-xl lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-6 w-6" /></button>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">{title}{config.environment !== 'production' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">{config.environment}</span>}</span>
            <div className="flex items-center gap-3">
              <span className="hidden text-right text-xs sm:block"><span className="block font-semibold text-ink-900">{email}</span><span className="text-ink-500">{role === 'admin' ? 'Main Admin' : 'Management (read-only)'}</span></span>
              <Button variant="secondary" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
            </div>
          </header>
          {open && (
            <div className="fixed inset-0 z-50 bg-ink-900/30 lg:hidden" onClick={() => setOpen(false)}>
              <aside className="h-full w-72 overflow-y-auto bg-white p-5 shadow-xl animate-fade" onClick={(e) => e.stopPropagation()}>
                <div className="mb-6 flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-6 w-6" /></button></div>
                {sidebar}
              </aside>
            </div>
          )}
          <main className="safe-x mx-auto max-w-6xl py-8 safe-bottom"><Outlet /></main>
        </div>
      </div>
    </StaffCtx.Provider>
  );
}
