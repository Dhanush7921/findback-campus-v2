import { Languages, Menu, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useI18n } from '../lib/i18n';
import { Logo } from './art';
import { ButtonLink } from './ui';
import { getSession } from '../lib/session';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button onClick={() => setLang(lang === 'en' ? 'te' : 'en')} className="nav-link inline-flex items-center gap-1.5" aria-label={lang === 'en' ? 'Switch to Telugu' : 'Switch to English'}>
      <Languages className="h-4 w-4" aria-hidden /> {t('lang.switch')}
    </button>
  );
}

export default function Layout() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const online = useOnline();
  useEffect(() => { setOpen(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const links = [
    ['/how-it-works', t('nav.how')],
    ['/guest', t('v2.guestT')],
    ['/help', t('nav.help')],
  ] as const;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">Skip to content</a>
      <header className="glass sticky top-0 z-40 border-x-0 border-t-0 no-print" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="safe-x mx-auto flex h-16 max-w-6xl items-center justify-between gap-3">
          <Link to="/" aria-label="FindBack home"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map(([to, label]) => <NavLink key={to} to={to} className="nav-link">{label}</NavLink>)}
            <LangToggle />
            <ButtonLink to={getSession('reporter') ? '/me' : '/student'} size="sm" className="ml-2">{t('v2.studentT')}</ButtonLink>
          </nav>
          <button className="grid h-11 w-11 place-items-center rounded-xl text-ink-700 hover:bg-silver-50 md:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-nav" aria-label={t('nav.menu')}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="safe-x border-t border-silver-100 pb-4 pt-2 md:hidden animate-fade" aria-label="Mobile">
            <div className="flex flex-col gap-1">
              <NavLink to="/" end className="nav-link py-3 text-base">{t('nav.home')}</NavLink>
              {links.map(([to, label]) => <NavLink key={to} to={to} className="nav-link py-3 text-base">{label}</NavLink>)}
              <NavLink to="/privacy" className="nav-link py-3 text-base">{t('nav.privacy')}</NavLink>
              <LangToggle />
              <ButtonLink to={getSession('reporter') ? '/me' : '/student'} className="mt-2">{t('v2.studentT')}</ButtonLink>
            </div>
          </nav>
        )}
      </header>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900 no-print" role="status">
          <WifiOff className="h-4 w-4" /> You are offline. Pages you opened still work; submitting needs a connection.
        </div>
      )}
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t border-silver-100 bg-white/60 no-print">
      <div className="safe-x mx-auto grid max-w-6xl gap-8 py-10 sm:grid-cols-[1.5fr_1fr_1fr] safe-bottom">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-ink-500">{t('footer.tagline')}</p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <Link className="text-ink-500 hover:text-teal-700" to="/student">{t('v2.studentT')}</Link>
          <Link className="text-ink-500 hover:text-teal-700" to="/guest">{t('v2.guestT')}</Link>
          <Link className="text-ink-500 hover:text-teal-700" to="/how-it-works">{t('nav.how')}</Link>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <Link className="text-ink-500 hover:text-teal-700" to="/help">{t('nav.help')}</Link>
          <Link className="text-ink-500 hover:text-teal-700" to="/privacy">{t('nav.privacy')}</Link>
          <Link className="text-ink-500 hover:text-teal-700" to="/staff">{t('v2.adminT')}</Link>
          <Link className="text-ink-500 hover:text-teal-700" to="/management">{t('v2.mgmtT')}</Link>
        </div>
      </div>
      <p className="pb-6 text-center text-xs text-ink-400">© {new Date().getFullYear()} FindBack</p>
    </footer>
  );
}
