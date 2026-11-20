import { GraduationCap, KeyRound, Smartphone, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { E164_RE, normalizePhone } from '../../../shared/domain';
import { Button, Card, Field, Input, Notice, PageSkeleton } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { sendOtp, type OtpChallenge } from '../../lib/auth';
import { useConfig } from '../../lib/config';
import { useI18n } from '../../lib/i18n';
import { getSession, saveSession } from '../../lib/session';

const MAX_SENDS_PER_HOUR = 5;
const COOLDOWNS = [30, 60, 120, 300];

/** Device-side resend limits (Firebase and the API enforce their own server-side limits as well). */
function sendLog(phone: string): number[] {
  try { return (JSON.parse(localStorage.getItem(`fb2.otp.${phone}`) ?? '[]') as number[]).filter((t) => Date.now() - t < 3600e3); } catch { return []; }
}
function recordSend(phone: string) {
  try { localStorage.setItem(`fb2.otp.${phone}`, JSON.stringify([...sendLog(phone), Date.now()])); } catch { /* ignore */ }
}

export default function PhoneLogin({ portal }: { portal: 'student' | 'guest' }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { config, status } = useConfig();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  useEffect(() => { if (challenge) codeRef.current?.focus(); }, [challenge]);

  if (getSession('reporter')) return <Navigate to="/me" replace />;
  if (status === 'loading') return <PageSkeleton />;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const e164 = normalizePhone(phone);
    if (!E164_RE.test(e164)) { setError('Enter a valid mobile number, e.g. 98765 43210 or +91 98765 43210.'); return; }
    const log = sendLog(e164);
    if (log.length >= MAX_SENDS_PER_HOUR) { setError(t('auth.limit')); return; }
    if (!config) { setError(t('common.unavailable')); return; }
    setBusy(true);
    try {
      const ch = await sendOtp(config, e164, 'recaptcha-container');
      recordSend(e164);
      setChallenge(ch);
      setSentTo(e164);
      setCode('');
      setCooldown(COOLDOWNS[Math.min(log.length, COOLDOWNS.length - 1)]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!challenge || !/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    setError(null);
    try {
      const idToken = await challenge.confirm(code);
      const r = await apiPost<{ token: string; expiresAt: number; profile: Record<string, string> }>('/api/auth/session', { idToken, portal });
      saveSession('reporter', r.token, r.expiresAt, { ...r.profile, portal });
      nav('/me', { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      if (ae.code === 'not_in_registry' || ae.code === 'registry_conflict') setChallenge(null);
    } finally {
      setBusy(false);
    }
  }

  const Icon = portal === 'student' ? GraduationCap : UserRound;
  const closed = portal === 'guest' && config && !config.guestReportsOpen;
  return (
    <div className="safe-x mx-auto max-w-md py-10 sm:py-16">
      <Card className="p-6 sm:p-8 animate-rise">
        <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-white"><Icon className="h-6 w-6" aria-hidden /></span>
        <h1 className="text-2xl font-extrabold">{t(portal === 'student' ? 'auth.studentTitle' : 'auth.guestTitle')}</h1>
        <p className="mt-2 text-sm text-ink-500">{t(portal === 'student' ? 'auth.studentLead' : 'auth.guestLead')}</p>
        {status !== 'ready' && <Notice tone="warn" className="mt-5">{status === 'unconfigured' ? t('common.notConnected') : t('common.unavailable')}</Notice>}
        {config && !config.auth.enabled && <Notice tone="warn" className="mt-5">Phone sign-in is being set up by the college. Please try again later.</Notice>}
        {closed && <Notice tone="warn" className="mt-5">Guest reporting is paused by the office.</Notice>}
        {config?.auth.devAuth && !config.auth.firebase && <Notice tone="info" className="mt-5">{t('auth.devNote')}</Notice>}
        <Notice tone="info" className="mt-5">Preview this role without a real OTP in the isolated <Link to={`/demo/${portal}`} className="font-bold underline">public demo</Link>. It uses fictional browser-only data.</Notice>

        {!challenge ? (
          <form onSubmit={send} className="mt-6 space-y-4" noValidate>
            <Field label={t('auth.phone')} required>
              {(id) => (
                <div className="relative">
                  <Smartphone className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input id={id} className="pl-11" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
                </div>
              )}
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={busy} disabled={status !== 'ready' || !config?.auth.enabled || !!closed}>{busy ? t('auth.sending') : t('auth.sendCode')}</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-4" noValidate>
            <p className="text-sm text-ink-700">{t('auth.codeSent')} <strong>{sentTo}</strong></p>
            <Field label={t('auth.code')} required>
              {(id) => (
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input ref={codeRef} id={id} className="pl-11 tracking-[0.4em] font-mono text-lg" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                </div>
              )}
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={busy}>{busy ? t('auth.verifying') : t('auth.verify')}</Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={() => { setChallenge(null); setError(null); }}>{t('auth.changeNumber')}</button>
              <button type="button" className="font-semibold text-teal-700 hover:underline disabled:text-ink-400 disabled:no-underline" disabled={cooldown > 0 || busy} onClick={() => send()}>
                {cooldown > 0 ? `${t('auth.resendIn')} ${cooldown}s` : t('auth.resend')}
              </button>
            </div>
          </form>
        )}
        <div id="recaptcha-container" />
        {error && <Notice tone="error" className="mt-5">{error}</Notice>}
        <div className="mt-6 space-y-2 border-t border-silver-100 pt-5 text-xs text-ink-500">
          {portal === 'student' && <p><Link to="/guest" className="font-semibold text-teal-700 hover:underline">{t('auth.notRegistered')}</Link></p>}
          {portal === 'guest' && <p>Students should use the <Link to="/student" className="font-semibold text-teal-700 hover:underline">Student Portal</Link> for college-verified tracking.</p>}
          <p>{t('auth.lostPhone')}</p>
        </div>
      </Card>
    </div>
  );
}
