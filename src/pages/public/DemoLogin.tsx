import { Building2, GraduationCap, KeyRound, LineChart, PlayCircle, ShieldCheck, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Field, Input, Notice } from '../../components/ui';
import { apiPost } from '../../lib/api';
import { DEMO_ACCOUNTS, enterDemo, type DemoRole } from '../../lib/demo';
import { saveSession } from '../../lib/session';

const dev = (d: object) => 'dev.' + btoa(JSON.stringify(d));
const ROLES: { role: DemoRole; icon: typeof GraduationCap; tone: string; text: string; to: string }[] = [
  { role: 'student', icon: GraduationCap, tone: 'from-emerald-500 to-teal-500', text: 'Report a lost item, track it, see matches, prove ownership, confirm receipt.', to: '/me' },
  { role: 'guest', icon: UserRound, tone: 'from-teal-500 to-cyan-500', text: 'Visitor reporting with visit details. Sees only their own reports.', to: '/me' },
  { role: 'admin', icon: ShieldCheck, tone: 'from-cyan-500 to-sky-600', text: 'Register found items with photos, match, verify claims, run handovers with proof.', to: '/staff' },
  { role: 'management', icon: LineChart, tone: 'from-sky-500 to-indigo-500', text: 'Executive dashboard, analytics, hotspots, reports and audit trail. Read-only.', to: '/management' },
];

/** Signs in to the in-browser demo engine only. These sessions cannot be used against the real API. */
async function demoSignIn(role: DemoRole) {
  enterDemo();
  const a = DEMO_ACCOUNTS[role];
  if (role === 'student' || role === 'guest') {
    const phone = (a as typeof DEMO_ACCOUNTS.student).phone;
    const r = await apiPost<{ token: string; expiresAt: number; profile: Record<string, string> }>('/api/auth/session', { portal: role, idToken: dev({ provider: 'phone', phone, uid: `demo-${phone.slice(-4)}` }) });
    saveSession('reporter', r.token, r.expiresAt, { ...r.profile, portal: role });
  } else {
    const r = await apiPost<{ token: string; expiresAt: number; email: string; role: string; name: string }>('/api/staff/session', { idToken: dev({ provider: 'google.com', email: (a as typeof DEMO_ACCOUNTS.admin).email }) });
    saveSession('staff', r.token, r.expiresAt, { email: r.email, role: r.role, name: r.name });
  }
}

function RoleCard({ role, icon: Icon, tone, text, to }: (typeof ROLES)[number]) {
  const nav = useNavigate();
  const a = DEMO_ACCOUNTS[role];
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e?: FormEvent, oneClick = false) {
    e?.preventDefault();
    setError('');
    if (!oneClick && (user.trim().toLowerCase() !== a.username || pass !== a.password)) { setError('Incorrect demo username or password.'); return; }
    setBusy(true);
    try { await demoSignIn(role); nav(to); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card className="flex flex-col p-6" data-testid={`demo-${role}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${tone} text-white`}><Icon className="h-5 w-5" /></span>
        <div><h2 className="text-lg font-extrabold">{a.label}</h2><p className="text-xs text-ink-500">{a.name}</p></div>
      </div>
      <p className="mt-3 text-sm text-ink-600">{text}</p>
      <div className="mt-3 rounded-xl bg-silver-50 p-3 font-mono text-xs text-ink-700">
        <p>Username: {a.username}</p><p>Password: {a.password}</p>
      </div>
      <Button className="mt-4 w-full" loading={busy} onClick={() => go(undefined, true)}><PlayCircle className="h-4 w-4" /> Enter demo as {a.label}</Button>
      <form onSubmit={go} className="mt-4 space-y-3 border-t border-silver-100 pt-4" noValidate>
        <Field label="Username">{(id) => <Input id={id} value={user} autoComplete="off" onChange={(e) => setUser(e.target.value)} placeholder={a.username} />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" value={pass} autoComplete="off" onChange={(e) => setPass(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
        <Button type="submit" variant="secondary" size="sm" className="w-full" loading={busy}><KeyRound className="h-4 w-4" /> Sign in</Button>
      </form>
    </Card>
  );
}

export default function DemoLogin() {
  return (
    <div className="safe-x mx-auto max-w-6xl py-10">
      <div className="mb-8 max-w-3xl">
        <span className="chip bg-amber-100 text-amber-900"><Building2 className="h-3.5 w-3.5" /> Interactive demo · fictional sample data</span>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Explore FindBack</h1>
        <p className="mt-2 text-ink-600">Pick a role. Everything runs inside this browser on fictional records, so you can try every step safely. Switch roles any time from the demo bar; all roles share the same demo data.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{ROLES.map((r) => <RoleCard key={r.role} {...r} />)}</div>
      <Card className="mt-8 p-6">
        <h2 className="font-extrabold">Suggested 5-minute walkthrough</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
          <li><strong>Student</strong>: report a lost <em>scientific calculator</em> (Block C, room 204).</li>
          <li><strong>Main Admin</strong>: see it under Complaints, register the found calculator with photos, open the complaint and propose the match.</li>
          <li><strong>Student</strong>: open the complaint, view the potential match and submit ownership evidence.</li>
          <li><strong>Main Admin</strong>: verify the claim, then Handovers → Start handover. A demo code is shown.</li>
          <li><strong>Student</strong>: Confirm receipt with that code and sign. <strong>Main Admin</strong>: add proof of handover and confirm release.</li>
          <li><strong>Management</strong>: the dashboard, analytics and audit trail now include the returned calculator.</li>
        </ol>
        <Notice tone="info" className="mt-4">Demo sign-ins and demo codes are simulations. They only work inside this demo and never reach the real FindBack service, Google Sheets or SMS.</Notice>
      </Card>
    </div>
  );
}
