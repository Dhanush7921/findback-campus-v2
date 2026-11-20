import { BadgeCheck, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { Button, fmtDate } from '../../components/ui';
import { firebaseSignOut } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { clearSession, getSession } from '../../lib/session';
import { MeCtx, type Profile } from './common';

export default function MeLayout() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [session, setSession] = useState(() => getSession('reporter'));
  useEffect(() => {
    const on = () => setSession(getSession('reporter'));
    window.addEventListener('fb-session', on);
    const id = setInterval(on, 30_000); // expire the UI with the token
    return () => { window.removeEventListener('fb-session', on); clearInterval(id); };
  }, []);
  if (!session) return <Navigate to="/" replace />;
  const m = session.meta ?? {};
  const profile: Profile = { type: m.type === 'Student' ? 'Student' : 'Guest', name: m.name ?? '', studentId: m.studentId, department: m.department, phone: m.phone ?? '' };
  const signOut = () => { clearSession('reporter'); void firebaseSignOut(); nav('/', { replace: true }); };
  const student = profile.type === 'Student';
  return (
    <MeCtx.Provider value={{ profile, expiresAt: session.expiresAt, signOut }}>
      <div className="safe-x mx-auto max-w-4xl py-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/me" className={`chip ${student ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
            {student ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {t(student ? 'me.student' : 'me.guest')}{profile.studentId ? ` · ${profile.studentId}` : ''} · {profile.phone}
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-400 sm:inline">{t('me.sessionEnds')} {fmtDate(new Date(session.expiresAt).toISOString())}</span>
            <Button variant="secondary" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> {t('me.signout')}</Button>
          </div>
        </div>
        <Outlet />
      </div>
    </MeCtx.Provider>
  );
}
