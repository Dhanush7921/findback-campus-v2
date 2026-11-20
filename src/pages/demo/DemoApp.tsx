import {
  BarChart3, Camera, ChevronRight, ClipboardCheck, FileCheck2,
  Home, LayoutDashboard, LogOut, MapPin, PackagePlus, RotateCcw, Search,
  ShieldCheck, Sparkles, UserRound, Users, X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, Field, Input, Notice, Select, Textarea } from '../../components/ui';

type Role = 'student' | 'guest' | 'admin' | 'management';
type Complaint = { id: string; ownerRole: 'student' | 'guest'; owner: string; item: string; category: string; location: string; description: string; status: string; created: string };
type FoundItem = { id: string; item: string; location: string; status: string; photo?: string };
type Claim = { id: string; complaintId: string; itemId: string; state: 'Pending' | 'Approved' | 'Rejected' };
type Handover = { id: string; complaintId: string; itemId: string; state: 'challenge_issued' | 'receiver_confirmed' | 'completed'; proof?: string; receiverName?: string; acknowledged?: boolean };
type DemoData = { complaints: Complaint[]; found: FoundItem[]; claims: Claim[]; handovers: Handover[]; audit: string[] };

const STORE = 'findback-v2-demo-data-v1';
const AUTH = 'findback-v2-demo-auth-v1';
const seeded: DemoData = {
  complaints: [
    { id: 'FB-DEMO-1001', ownerRole: 'student', owner: 'Aarav Kumar', item: 'Blue backpack', category: 'Bag', location: 'Central Library — 2nd floor', description: 'Navy backpack with a silver zip and a small rocket keychain.', status: 'Ready for Collection', created: '20 Nov 2026, 10:20' },
    { id: 'FB-DEMO-1002', ownerRole: 'student', owner: 'Aarav Kumar', item: 'Scientific calculator', category: 'Electronics', location: 'Block C — Lab 204', description: 'Grey calculator in a transparent cover.', status: 'Under Review', created: '19 Nov 2026, 16:05' },
    { id: 'FB-DEMO-2001', ownerRole: 'guest', owner: 'Maya Rao', item: 'Brown wallet', category: 'Wallet', location: 'Main auditorium lobby', description: 'Compact brown wallet with a metal button.', status: 'Potential Match', created: '20 Nov 2026, 09:40' },
  ],
  found: [
    { id: 'FI-DEMO-301', item: 'Navy backpack', location: 'Central Library', status: 'Reserved for approved claim' },
    { id: 'FI-DEMO-302', item: 'Brown wallet', location: 'Auditorium lobby', status: 'Claim pending' },
    { id: 'FI-DEMO-303', item: 'Silver water bottle', location: 'Sports block', status: 'Available' },
  ],
  claims: [
    { id: 'CL-DEMO-41', complaintId: 'FB-DEMO-1001', itemId: 'FI-DEMO-301', state: 'Approved' },
    { id: 'CL-DEMO-42', complaintId: 'FB-DEMO-2001', itemId: 'FI-DEMO-302', state: 'Pending' },
  ],
  handovers: [{ id: 'HO-DEMO-71', complaintId: 'FB-DEMO-1001', itemId: 'FI-DEMO-301', state: 'challenge_issued' }],
  audit: [
    '10:44 · Main Admin approved claim CL-DEMO-41',
    '10:31 · Match proposed for FB-DEMO-2001',
    '10:20 · Student submitted FB-DEMO-1001',
    '09:52 · Found item FI-DEMO-301 registered',
  ],
};

function loadData(): DemoData {
  try { return JSON.parse(localStorage.getItem(STORE) || '') as DemoData; } catch { return structuredClone(seeded); }
}

function roleLabel(role: Role) {
  return role === 'admin' ? 'Main Admin' : role[0].toUpperCase() + role.slice(1);
}

function DemoBadge() {
  return <span className="inline-flex items-center gap-2 rounded-full border border-violet-300/40 bg-violet-500/15 px-3 py-1 text-xs font-extrabold tracking-[.12em] text-violet-100"><Sparkles className="h-3.5 w-3.5" /> DEMO — NO REAL DATA</span>;
}

function RoleChooser() {
  const roles: Array<[Role, string, string, typeof UserRound]> = [
    ['student', 'Student', 'Submit a lost-item report, track progress and upload receiver proof.', UserRound],
    ['guest', 'Guest', 'Use a fictional guest identity to submit and privately track a complaint.', Users],
    ['admin', 'Main Admin', 'Register found items, review claims and complete verified handovers.', ShieldCheck],
    ['management', 'Management', 'Inspect analytics, hotspots and audit records in read-only mode.', BarChart3],
  ];
  return (
    <main className="min-h-dvh bg-[#090d20] px-4 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4"><Link to="/" className="text-xl font-extrabold text-white">FindBack <span className="text-violet-400">V2</span></Link><DemoBadge /></div>
        <section className="mt-14 grid items-center gap-10 lg:grid-cols-[1.2fr_.8fr]">
          <div><p className="text-sm font-bold uppercase tracking-[.18em] text-violet-300">Interactive public preview</p><h1 className="mt-4 text-4xl font-extrabold leading-tight text-white sm:text-6xl">See every recovery workflow before institutional setup.</h1><p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">Choose a fictional role. Everything stays in this browser, uses mock-only records and can be reset at any time.</p></div>
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-600/30 to-cyan-500/10 p-7 shadow-2xl shadow-violet-950/50"><ShieldCheck className="h-11 w-11 text-violet-300" /><h2 className="mt-5 text-2xl font-bold text-white">Safe by design</h2><p className="mt-3 leading-relaxed text-slate-300">No Firebase, OTP, Google Sheets, Cloud Run or real student registry is contacted in demo mode.</p></div>
        </section>
        <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Demo roles">
          {roles.map(([role, title, text, Icon]) => <Link key={role} to={`/demo/${role}`} className="group rounded-3xl border border-white/10 bg-white/[.06] p-6 transition hover:-translate-y-1 hover:border-violet-400/50 hover:bg-white/[.09]"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/20 text-violet-300"><Icon className="h-6 w-6" /></div><h2 className="mt-5 text-xl font-bold text-white">{title}</h2><p className="mt-2 min-h-20 text-sm leading-relaxed text-slate-400">{text}</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-violet-300">Open demo <ChevronRight className="h-4 w-4" /></span></Link>)}
        </section>
      </div>
    </main>
  );
}

function DemoLogin({ role, onLogin }: { role: Role; onLogin: () => void }) {
  const copy = {
    student: ['Aarav Kumar', '22CSE104', 'Student ID'],
    guest: ['Maya Rao', '+91 90000 00000', 'Verified phone'],
    admin: ['Priya Sharma', 'admin@demo.findback.test', 'Staff email'],
    management: ['Dr. R. Mehta', 'management@demo.findback.test', 'Management email'],
  }[role];
  return (
    <main className="grid min-h-dvh bg-[#f5f6fb] lg:grid-cols-[.9fr_1.1fr]">
      <section className="relative hidden overflow-hidden bg-[#0b1026] p-12 text-white lg:flex lg:flex-col lg:justify-between"><div><Link to="/demo" className="text-xl font-extrabold text-white">FindBack <span className="text-violet-400">V2</span></Link><div className="mt-8"><DemoBadge /></div></div><div><p className="text-sm font-bold uppercase tracking-[.18em] text-violet-300">{roleLabel(role)} portal</p><h1 className="mt-4 text-5xl font-extrabold leading-tight text-white">A complete recovery workflow, ready to explore.</h1><p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-300">This sign-in is simulated. It does not prove identity and must never be used for production access.</p></div><p className="text-sm text-slate-500">Fictional identity · Browser-only session · Resettable data</p></section>
      <section className="flex items-center justify-center p-5 sm:p-10"><Card className="w-full max-w-lg p-7 sm:p-10"><div className="lg:hidden"><DemoBadge /></div><div className="mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-700"><UserRound className="h-7 w-7" /></div><p className="mt-7 text-xs font-extrabold uppercase tracking-[.16em] text-violet-700">{roleLabel(role)} demo sign-in</p><h1 className="mt-2 text-3xl font-extrabold">Continue as {copy[0]}</h1><p className="mt-2 text-ink-500">No password or real OTP is required for this public preview.</p><div className="mt-7 space-y-4"><Field label="Fictional name">{(id) => <Input id={id} value={copy[0]} readOnly />}</Field><Field label={copy[2]}>{(id) => <Input id={id} value={copy[1]} readOnly />}</Field><Notice tone="warn"><strong>DEMO — NO REAL DATA.</strong> Production sign-in remains protected by Firebase phone OTP, institutional registry and role checks.</Notice><Button className="w-full !bg-violet-700" size="lg" onClick={onLogin}>Enter {roleLabel(role)} demo <ChevronRight className="h-5 w-5" /></Button><Link to="/demo" className="block text-center text-sm font-semibold text-violet-700">Choose another role</Link></div></Card></section>
    </main>
  );
}

function DemoShell({ role, view, setView, logout, reset, children }: { role: Role; view: string; setView: (v: string) => void; logout: () => void; reset: () => void; children: ReactNode }) {
  const nav: Record<Role, Array<[string, string, typeof Home]>> = {
    student: [['dashboard', 'My complaints', LayoutDashboard], ['submit', 'Report lost item', PackagePlus], ['proof', 'Handover proof', FileCheck2]],
    guest: [['dashboard', 'My complaints', LayoutDashboard], ['submit', 'Report lost item', PackagePlus], ['track', 'Track complaint', Search]],
    admin: [['dashboard', 'Operations', LayoutDashboard], ['found', 'Register found item', PackagePlus], ['claims', 'Verify claims', ClipboardCheck], ['handovers', 'Handovers', FileCheck2]],
    management: [['dashboard', 'Executive view', LayoutDashboard], ['analytics', 'Analytics', BarChart3], ['hotspots', 'Hotspots', MapPin], ['audit', 'Audit trail', FileCheck2]],
  };
  return (
    <div className="min-h-dvh bg-[#f5f6fb] lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="bg-[#0b1026] px-4 py-5 text-white lg:sticky lg:top-0 lg:h-dvh lg:p-6"><div className="flex items-center justify-between"><button onClick={() => setView('dashboard')} className="text-xl font-extrabold">FindBack <span className="text-violet-400">V2</span></button><span className="rounded-lg bg-violet-500/20 px-2 py-1 text-[10px] font-extrabold tracking-wider text-violet-200">DEMO</span></div><p className="mt-2 text-sm text-slate-400">{roleLabel(role)} portal</p><nav className="mt-6 flex gap-2 overflow-x-auto lg:flex-col" aria-label={`${roleLabel(role)} demo navigation`}>{nav[role].map(([id, label, Icon]) => <button key={id} onClick={() => setView(id)} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === id ? 'bg-violet-600 text-white shadow-lg shadow-violet-950/40' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav><div className="mt-6 border-t border-white/10 pt-5 lg:absolute lg:bottom-6 lg:left-6 lg:right-6"><button onClick={reset} className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"><RotateCcw className="h-4 w-4" /> Reset demo data</button><button onClick={logout} className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"><LogOut className="h-4 w-4" /> Exit role</button></div></aside>
      <div><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-8"><DemoBadge /><Link to="/" className="text-sm font-semibold text-violet-700">Production home</Link></header><main className="p-5 sm:p-8 lg:p-10">{children}</main></div>
    </div>
  );
}

function Stat({ label, value, tone = 'violet' }: { label: string; value: string | number; tone?: 'violet' | 'cyan' | 'amber' | 'green' }) {
  const cls = { violet: 'from-violet-600 to-indigo-600', cyan: 'from-cyan-500 to-blue-600', amber: 'from-amber-400 to-orange-500', green: 'from-emerald-500 to-teal-600' }[tone];
  return <div className={`rounded-3xl bg-gradient-to-br ${cls} p-6 text-white shadow-lg`}><p className="text-sm font-medium text-white/75">{label}</p><p className="mt-3 text-4xl font-extrabold text-white">{value}</p></div>;
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <header className="mb-7"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-violet-700">{eyebrow}</p><h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-ink-500">{text}</p></header>;
}

function ComplaintList({ role, data }: { role: 'student' | 'guest'; data: DemoData }) {
  const rows = data.complaints.filter((c) => c.ownerRole === role);
  return <><PageTitle eyebrow={`${roleLabel(role)} dashboard`} title={`Welcome, ${role === 'student' ? 'Aarav' : 'Maya'}`} text="Track fictional reports and view every status change from one private workspace." /><div className="grid gap-4 sm:grid-cols-3"><Stat label="My reports" value={rows.length} /><Stat label="Active cases" value={rows.filter((x) => x.status !== 'Returned').length} tone="cyan" /><Stat label="Ready to collect" value={rows.filter((x) => x.status === 'Ready for Collection').length} tone="green" /></div><section className="mt-8 space-y-4"><h2 className="text-xl font-bold">Recent complaints</h2>{rows.map((c) => <Card key={c.id} className="p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="font-mono text-xs font-bold text-violet-700">{c.id}</p><h3 className="mt-1 text-lg font-bold">{c.item}</h3><p className="mt-1 text-sm text-ink-500">{c.location} · {c.created}</p></div><span className={`self-start rounded-full px-3 py-1 text-xs font-bold ${c.status === 'Ready for Collection' ? 'bg-emerald-100 text-emerald-800' : c.status === 'Potential Match' ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-800'}`}>{c.status}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-3/4 rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" /></div></Card>)}</section></>;
}

function ReportForm({ role, add }: { role: 'student' | 'guest'; add: (c: Complaint) => void }) {
  const [f, setF] = useState({ item: '', category: '', location: '', description: '' });
  const [done, setDone] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.item || !f.category || !f.location || f.description.length < 10) return; const id = `FB-DEMO-${Math.floor(3000 + Math.random() * 6000)}`; add({ id, ownerRole: role, owner: role === 'student' ? 'Aarav Kumar' : 'Maya Rao', ...f, status: 'Submitted', created: 'Just now' }); setDone(id); setF({ item: '', category: '', location: '', description: '' }); };
  return <><PageTitle eyebrow="Mock-only submission" title="Report a lost item" text="Validation and workflow transitions work normally, but this report stays only in your browser." />{done && <Notice tone="success" className="mb-5">Complaint <strong>{done}</strong> was created in demo mode.</Notice>}<form onSubmit={submit}><Card className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8"><Field label="Item name" required>{(id) => <Input id={id} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="e.g. Black headphones" required />}</Field><Field label="Category" required>{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required><option value="">Choose…</option><option>Electronics</option><option>Bag</option><option>Wallet</option><option>Documents</option><option>Other</option></Select>}</Field><Field label="Last seen location" required className="sm:col-span-2">{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Building and room/area" required />}</Field><Field label="Private description" required hint="Include a detail only the real owner would know." className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} minLength={10} required />}</Field><Notice tone="info" className="sm:col-span-2">This demo submission never leaves this device and cannot be seen by the production staff portal.</Notice><Button type="submit" className="sm:col-span-2 sm:w-fit">Submit demo complaint</Button></Card></form></>;
}

function HandoverProof({ data, update }: { data: DemoData; update: (fn: (d: DemoData) => void) => void }) {
  const h = data.handovers[0];
  const [proof, setProof] = useState(h.proof || '');
  const [ack, setAck] = useState(Boolean(h.acknowledged));
  const [uploading, setUploading] = useState(false);
  const choose = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => setProof(String(reader.result)); reader.readAsDataURL(file); };
  const upload = () => { setUploading(true); window.setTimeout(() => { update((d) => { d.handovers[0] = { ...d.handovers[0], state: 'receiver_confirmed', proof, acknowledged: true, receiverName: 'Aarav Kumar' }; d.audit.unshift('Just now · Receiver uploaded handover proof and acknowledged collection'); }); setUploading(false); }, 650); };
  return <><PageTitle eyebrow="Receiver confirmation" title="Handover proof upload" text="The actual receiver captures or selects proof, previews it, and acknowledges collection. Staff release remains a separate action." /><div className="grid gap-6 lg:grid-cols-[1fr_.8fr]"><Card className="p-6 sm:p-8"><div className="flex items-start gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-700"><Camera className="h-5 w-5" /></div><div><h2 className="font-bold">Receiver evidence</h2><p className="text-sm text-ink-500">Complaint FB-DEMO-1001 · Blue backpack</p></div></div><label className="mt-6 flex min-h-52 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/50 text-center transition hover:bg-violet-50">{proof ? <img src={proof} alt="Receiver proof preview" className="h-64 w-full object-cover" /> : <><Camera className="h-9 w-9 text-violet-600" /><strong className="mt-3">Capture or select receiver proof</strong><span className="mt-1 text-sm text-ink-500">JPG, PNG or camera image</span></>}<input aria-label="Receiver proof image" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} /></label>{proof && <button type="button" onClick={() => setProof('')} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-rose-600"><X className="h-4 w-4" /> Remove preview</button>}<label className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 accent-violet-600" /> I am the actual receiver and confirm this proof relates to my collection. I understand staff must separately verify my identity and release the item.</label><Button className="mt-5 w-full !bg-violet-700" disabled={!proof || !ack || h.state !== 'challenge_issued'} loading={uploading} onClick={upload}>{h.state === 'challenge_issued' ? 'Upload proof & acknowledge' : 'Receiver confirmation saved'}</Button>{h.state === 'receiver_confirmed' && <Notice tone="success" className="mt-4">Proof uploaded. Awaiting separate physical ID check and staff release.</Notice>}</Card><Card className="h-fit p-6"><h2 className="font-bold">Two-step protection</h2><ol className="mt-5 space-y-5">{[['1', 'Receiver confirmation', h.state === 'challenge_issued' ? 'Waiting for proof upload' : 'Completed'], ['2', 'Staff physical release', h.state === 'completed' ? 'Completed' : 'Still required']].map(([n, title, state]) => <li key={n} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 font-bold text-violet-700">{n}</span><div><strong>{title}</strong><p className="text-sm text-ink-500">{state}</p></div></li>)}</ol><Notice tone="warn" className="mt-6">Normal counter collection only. No home-delivery workflow is represented here.</Notice></Card></div></>;
}

function Admin({ view, data, update }: { view: string; data: DemoData; update: (fn: (d: DemoData) => void) => void }) {
  const [photo, setPhoto] = useState('');
  const [f, setF] = useState({ item: '', location: '', storage: '' });
  const [saved, setSaved] = useState('');
  if (view === 'found') {
    const pick = (file?: File) => { if (!file) return; const r = new FileReader(); r.onload = () => setPhoto(String(r.result)); r.readAsDataURL(file); };
    const submit = (e: FormEvent) => { e.preventDefault(); if (!f.item || !f.location || !f.storage || !photo) return; const id = `FI-DEMO-${400 + data.found.length}`; update((d) => { d.found.unshift({ id, item: f.item, location: f.location, status: 'Available', photo }); d.audit.unshift(`Just now · Main Admin registered ${id} with private photo`); }); setSaved(id); setF({ item: '', location: '', storage: '' }); setPhoto(''); };
    return <><PageTitle eyebrow="Private inventory" title="Register found item" text="Record the item, storage location and staff-only photos. The upload is simulated in demo mode." />{saved && <Notice tone="success" className="mb-5">Found item <strong>{saved}</strong> registered with its mock photo.</Notice>}<form onSubmit={submit}><Card className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8"><Field label="Item name" required>{(id) => <Input id={id} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} required />}</Field><Field label="Found location" required>{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} required />}</Field><Field label="Secure storage location" required className="sm:col-span-2">{(id) => <Input id={id} value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} placeholder="e.g. Cabinet A · Shelf 2" required />}</Field><div className="sm:col-span-2"><p className="label">Found-item photo <span className="text-rose-600">*</span></p><label className="flex min-h-48 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/40">{photo ? <img src={photo} alt="Found item preview" className="h-64 w-full object-cover" /> : <div className="text-center"><Camera className="mx-auto h-9 w-9 text-violet-600" /><strong className="mt-2 block">Capture or choose a photo</strong><span className="text-sm text-ink-500">Preview appears before upload</span></div>}<input aria-label="Found item photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label></div><Notice tone="info" className="sm:col-span-2">Photos are private and visible only to authorized staff in production.</Notice><Button type="submit" disabled={!photo} className="sm:col-span-2 sm:w-fit">Simulate upload & register</Button></Card></form></>;
  }
  if (view === 'claims') return <><PageTitle eyebrow="Ownership checks" title="Verify claims" text="Compare private evidence, approve a valid claimant or reject conflicting claims." /><div className="space-y-4">{data.claims.map((c) => <Card key={c.id} className="p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="font-mono text-xs font-bold text-violet-700">{c.id}</p><h2 className="mt-1 font-bold">{c.complaintId} ↔ {c.itemId}</h2><p className="mt-2 text-sm text-ink-500">Private evidence: “Initials MK inside the wallet lining.”</p></div><span className="self-start rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{c.state}</span></div>{c.state === 'Pending' && <div className="mt-5 flex gap-2"><Button size="sm" onClick={() => update((d) => { const x = d.claims.find((x) => x.id === c.id); if (x) x.state = 'Approved'; d.audit.unshift(`Just now · Main Admin approved ${c.id}`); })}>Approve claim</Button><Button size="sm" variant="danger" onClick={() => update((d) => { const x = d.claims.find((x) => x.id === c.id); if (x) x.state = 'Rejected'; })}>Reject</Button></div>}</Card>)}</div></>;
  if (view === 'handovers') { const h = data.handovers[0]; return <><PageTitle eyebrow="Counter collection" title="Receiver-confirmed handover" text="Receiver evidence and staff physical release are deliberately separate controls." /><Card className="p-6 sm:p-8"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="font-mono text-xs font-bold text-violet-700">{h.id}</p><h2 className="mt-1 text-xl font-bold">Blue backpack · {h.complaintId}</h2><p className="mt-2 text-sm text-ink-500">Receiver: {h.receiverName || 'Awaiting receiver confirmation'}</p></div><span className={`self-start rounded-full px-3 py-1 text-xs font-bold ${h.state === 'receiver_confirmed' ? 'bg-emerald-100 text-emerald-800' : h.state === 'completed' ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-800'}`}>{h.state.replace('_', ' ')}</span></div>{h.proof ? <div className="mt-6 grid gap-5 sm:grid-cols-[220px_1fr]"><img src={h.proof} alt="Uploaded receiver handover proof" className="h-44 w-full rounded-2xl object-cover" /><div><p className="font-bold">Receiver evidence uploaded</p><p className="mt-1 text-sm text-ink-500">Acknowledgment recorded separately. Staff must now inspect physical ID.</p><label className="mt-4 flex items-start gap-3 text-sm"><input id="staff-id-check" type="checkbox" className="mt-0.5 h-5 w-5 accent-violet-600" /> I physically checked the receiver's ID and the item is being released now.</label><Button className="mt-4" disabled={h.state !== 'receiver_confirmed'} onClick={() => { const cb = document.querySelector<HTMLInputElement>('#staff-id-check'); if (!cb?.checked) { cb?.focus(); return; } update((d) => { d.handovers[0].state = 'completed'; const c = d.complaints.find((x) => x.id === h.complaintId); if (c) c.status = 'Returned'; d.audit.unshift('Just now · Main Admin completed physical staff release'); }); }}>Complete staff release</Button></div></div> : <Notice tone="warn" className="mt-6">Waiting for the receiver to upload proof and acknowledgment in the Student demo.</Notice>}</Card></>; }
  return <><PageTitle eyebrow="Main Admin dashboard" title="Campus recovery operations" text="A single workspace for found inventory, ownership verification and controlled handover." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Open complaints" value={data.complaints.filter((x) => x.status !== 'Returned').length} /><Stat label="Found inventory" value={data.found.length} tone="cyan" /><Stat label="Claims pending" value={data.claims.filter((x) => x.state === 'Pending').length} tone="amber" /><Stat label="Ready to hand over" value={data.handovers.filter((x) => x.state !== 'completed').length} tone="green" /></div><div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]"><Card className="p-6"><h2 className="text-xl font-bold">Priority queue</h2><div className="mt-4 space-y-3">{[['Claim review', 'CL-DEMO-42 · Brown wallet'], ['Receiver proof', 'HO-DEMO-71 · Blue backpack'], ['New report', 'FB-DEMO-1002 · Calculator']].map(([a, b]) => <div key={a} className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><div><strong className="text-sm">{a}</strong><p className="text-xs text-ink-500">{b}</p></div><ChevronRight className="h-4 w-4 text-violet-600" /></div>)}</div></Card><Card className="bg-gradient-to-br from-[#121936] to-[#25205b] p-6 text-white"><ShieldCheck className="h-8 w-8 text-violet-300" /><h2 className="mt-4 text-xl font-bold text-white">Separation of duties</h2><p className="mt-2 text-sm leading-relaxed text-slate-300">Receiver acknowledgment never marks an item Returned. A staff member must complete physical release.</p></Card></div></>;
}

function Management({ view, data }: { view: string; data: DemoData }) {
  if (view === 'hotspots') return <><PageTitle eyebrow="Read-only intelligence" title="Loss hotspots" text="Fictional locations ranked from mock reports. No controls can alter operational records." /><Card className="p-6"><div className="space-y-5">{[['Central Library', 12, '85%'], ['Block C laboratories', 9, '64%'], ['Main auditorium', 7, '50%'], ['Sports block', 4, '29%']].map(([name, count, width]) => <div key={String(name)}><div className="flex justify-between text-sm"><strong>{name}</strong><span>{count} reports</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-400" style={{ width: String(width) }} /></div></div>)}</div></Card></>;
  if (view === 'audit') return <><PageTitle eyebrow="Immutable view" title="Audit trail" text="Chronological mock events for accountability. Management cannot edit or delete them." /><Card className="overflow-hidden"><div className="divide-y divide-slate-100">{data.audit.map((a, i) => <div key={`${a}-${i}`} className="flex gap-4 p-5"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" /><p className="text-sm">{a}</p></div>)}</div></Card></>;
  if (view === 'analytics') return <><PageTitle eyebrow="Read-only analytics" title="Recovery performance" text="Fictional operating metrics for a 30-day demonstration period." /><div className="grid gap-4 sm:grid-cols-3"><Stat label="Reports received" value="128" /><Stat label="Recovery rate" value="68%" tone="green" /><Stat label="Median resolution" value="2.4d" tone="cyan" /></div><Card className="mt-7 p-6"><h2 className="font-bold">Weekly reports and recoveries</h2><div className="mt-8 flex h-52 items-end justify-around gap-4">{[['W1', 65, 44], ['W2', 82, 57], ['W3', 72, 52], ['W4', 96, 68]].map(([w, total, recovered]) => <div key={String(w)} className="flex flex-1 flex-col items-center"><div className="flex h-40 items-end gap-2"><div className="w-7 rounded-t-lg bg-violet-500" style={{ height: `${total}%` }} /><div className="w-7 rounded-t-lg bg-cyan-400" style={{ height: `${recovered}%` }} /></div><span className="mt-2 text-xs font-bold">{w}</span></div>)}</div></Card></>;
  return <><PageTitle eyebrow="Management dashboard · read-only" title="Institutional overview" text="Monitor outcomes without access to student identities, private evidence or mutation controls." /><Notice tone="info" className="mb-6"><strong>Strictly read-only:</strong> this role cannot register items, decide claims or complete handovers.</Notice><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Open reports" value="38" /><Stat label="Items returned" value="87" tone="green" /><Stat label="Pending claims" value="11" tone="amber" /><Stat label="Avg. response" value="4.2h" tone="cyan" /></div><div className="mt-8 grid gap-6 lg:grid-cols-2"><Card className="p-6"><h2 className="text-xl font-bold">Top categories</h2>{[['Electronics', 34], ['ID cards', 26], ['Bags', 21], ['Wallets', 14]].map(([n, v]) => <div key={String(n)} className="mt-4 flex items-center justify-between"><span className="text-sm font-medium">{n}</span><strong>{v}</strong></div>)}</Card><Card className="p-6"><h2 className="text-xl font-bold">Control health</h2>{[['Production authentication', 'Configured separately'], ['Evidence privacy', 'Staff-only'], ['Audit coverage', '100%'], ['Management permissions', 'Read-only']].map(([n, v]) => <div key={n} className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-ink-500">{n}</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{v}</span></div>)}</Card></div></>;
}

export default function DemoApp() {
  const { role: raw } = useParams();
  const role = (['student', 'guest', 'admin', 'management'].includes(raw || '') ? raw : '') as Role | '';
  const nav = useNavigate();
  const [auth, setAuth] = useState(() => sessionStorage.getItem(AUTH) || '');
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState<DemoData>(loadData);
  useEffect(() => { if (role) setView('dashboard'); }, [role]);
  const update = (fn: (d: DemoData) => void) => setData((old) => { const next = structuredClone(old); fn(next); localStorage.setItem(STORE, JSON.stringify(next)); return next; });
  const reset = () => { localStorage.removeItem(STORE); setData(structuredClone(seeded)); setView('dashboard'); };
  const content = useMemo(() => {
    if (role === 'student') return view === 'submit' ? <ReportForm role="student" add={(c) => update((d) => { d.complaints.unshift(c); d.audit.unshift(`Just now · Student submitted ${c.id}`); })} /> : view === 'proof' ? <HandoverProof data={data} update={update} /> : <ComplaintList role="student" data={data} />;
    if (role === 'guest') return view === 'submit' ? <ReportForm role="guest" add={(c) => update((d) => { d.complaints.unshift(c); d.audit.unshift(`Just now · Guest submitted ${c.id}`); })} /> : <ComplaintList role="guest" data={data} />;
    if (role === 'admin') return <Admin view={view} data={data} update={update} />;
    return <Management view={view} data={data} />;
  }, [role, view, data]);
  if (!role) return <RoleChooser />;
  if (auth !== role) return <DemoLogin role={role} onLogin={() => { sessionStorage.setItem(AUTH, role); setAuth(role); }} />;
  return <DemoShell role={role} view={view} setView={setView} reset={reset} logout={() => { sessionStorage.removeItem(AUTH); setAuth(''); }}><button onClick={() => nav('/demo')} className="sr-only">Choose role</button>{content}</DemoShell>;
}
