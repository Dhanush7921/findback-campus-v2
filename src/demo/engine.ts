/**
 * In-browser demo engine: the real FindBack API code (api/src/app.ts) running on an in-memory store with
 * fictional sample data. Loaded only in demo mode. It has no network access path to the real backend:
 * no API base URL, no Google Sheets, no Cloud Storage, no Firebase. State is kept in IndexedDB for the
 * current browser session only (keyed by a per-tab session id) and can be reset at any time.
 */
import { createApp } from '../../api/src/app';
import { MemoryStore } from '../../api/src/store/memory';
import type { FileData } from '../../api/src/store/types';
import { DEMO_ACCOUNTS } from '../lib/demo';

const ORIGIN = 'https://demo.findback.local';
const SID_KEY = 'fb2.demo.sid';
interface Snapshot { sid: string; pepper: string; sessionKey: string; tables: Record<string, Record<string, string>[]>; files: [string, FileData][] }

// ---------- tiny IndexedDB wrapper (falls back to memory only) ----------
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('findback-demo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function idbGet(): Promise<Snapshot | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => { const q = db.transaction('state').objectStore('state').get('snapshot'); q.onsuccess = () => res((q.result as Snapshot) ?? null); q.onerror = () => res(null); });
}
async function idbPut(s: Snapshot | null) {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => { const tx = db.transaction('state', 'readwrite'); if (s) tx.objectStore('state').put(s, 'snapshot'); else tx.objectStore('state').delete('snapshot'); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
function sessionId() {
  try {
    let s = sessionStorage.getItem(SID_KEY);
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem(SID_KEY, s); }
    return s;
  } catch { return 'nosession'; }
}

// ---------- engine ----------
let engine: Promise<{ handle: (r: Request) => Promise<Response>; store: MemoryStore; snap: () => Snapshot }> | null = null;

function build(s: Pick<Snapshot, 'sid' | 'pepper' | 'sessionKey'>, store: MemoryStore) {
  const handle = createApp({
    env: {
      APP_ENV: 'development', DEV_AUTH: '1', DATA_ENV: 'staging', HASH_PEPPER: s.pepper, SESSION_KEY: s.sessionKey,
      ALLOWED_ORIGINS: ORIGIN, BOOTSTRAP_ADMINS: '',
    },
    store,
  });
  const snap = (): Snapshot => ({ ...s, tables: store.tables, files: [...store.files.entries()] });
  return { handle, store, snap };
}

async function init() {
  const sid = sessionId();
  const saved = await idbGet();
  const store = new MemoryStore();
  if (saved && saved.sid === sid) {
    store.tables = saved.tables;
    store.files = new Map(saved.files);
    return build(saved, store);
  }
  const e = build({ sid, pepper: rand(), sessionKey: rand() }, store);
  await seed(e.handle, store);
  await idbPut(e.snap());
  return e;
}

const quiet = <T>(fn: () => Promise<T>) => async () => {
  // The API writes one structured log line per request; keep the demo console clean.
  const orig = console.log;
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('{"')) return; orig(...a); };
  try { return await fn(); } finally { console.log = orig; }
};

export async function handleDemo(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Response> {
  engine ??= init();
  const e = await engine;
  const res = await quiet(() => e.handle(new Request(ORIGIN + path, { method, headers: { ...headers, origin: ORIGIN }, body })))();
  if (method !== 'GET' && method !== 'HEAD') await idbPut(e.snap());
  return res;
}

export async function resetDemoData() {
  await idbPut(null);
  try { sessionStorage.removeItem(SID_KEY); } catch { /* ignore */ }
  engine = null;
}

// ---------- fictional sample data ----------
export const devToken = (d: object) => 'dev.' + btoa(JSON.stringify(d));

function sampleImage(label: string, hue: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 360;
  const g = c.getContext('2d');
  if (!g) return Promise.resolve('');
  const grad = g.createLinearGradient(0, 0, 480, 360);
  grad.addColorStop(0, `hsl(${hue} 70% 88%)`); grad.addColorStop(1, `hsl(${hue + 40} 70% 70%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 480, 360);
  g.fillStyle = `hsl(${hue} 50% 30%)`; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(label, 240, 175);
  g.font = '16px system-ui, sans-serif'; g.fillText('DEMO PHOTO · SAMPLE DATA', 240, 215);
  return new Promise((res) => c.toBlob(async (b) => {
    if (!b) return res('');
    const buf = new Uint8Array(await b.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    res(btoa(bin));
  }, 'image/jpeg', 0.8));
}

const STUDENTS = [
  { sid: '21CSE045', name: DEMO_ACCOUNTS.student.name, dept: 'Computer Science', year: 'III', phone: DEMO_ACCOUNTS.student.phone },
  { sid: '22ECE012', name: 'Diya Patel', dept: 'Electronics', year: 'II', phone: '+919000000002' },
  { sid: '21MEC033', name: 'Rohan Verma', dept: 'Mechanical', year: 'III', phone: '+919000000003' },
  { sid: '23CIV007', name: 'Sneha Reddy', dept: 'Civil', year: 'I', phone: '+919000000004' },
  { sid: '22IT019', name: 'Kabir Singh', dept: 'Information Technology', year: 'II', phone: '+919000000005' },
  { sid: '21EEE028', name: 'Ananya Rao', dept: 'Electrical', year: 'III', phone: '+919000000006' },
];

async function seed(handle: (r: Request) => Promise<Response>, store: MemoryStore) {
  const t = new Date().toISOString();
  for (const s of STUDENTS) store.tables.Student_Registry.push({ student_id: s.sid, name: s.name, department: s.dept, year: s.year, phone: s.phone, email: `${s.sid.toLowerCase()}@demo.findback`, status: 'active', sessions_valid_after: '', updated_at: t, updated_by: 'demo seed', notes: 'Fictional demo record', version: '1' });
  for (const [email, role, name] of [[DEMO_ACCOUNTS.admin.email, 'admin', DEMO_ACCOUNTS.admin.name], ['office2@demo.findback', 'admin', 'Office Assistant (demo)'], [DEMO_ACCOUNTS.management.email, 'management', DEMO_ACCOUNTS.management.name]]) {
    store.tables.Staff_Roles.push({ email, role, name, status: 'active', added_at: t, added_by: 'demo seed', updated_at: t, version: '1' });
  }
  for (const [key, value] of [['home_delivery_enabled', 'true'], ['collection_office', 'Student Affairs Office, Ground Floor, Admin Block (demo)']]) store.tables.Application_Settings.push({ key, value, updated_at: t, updated_by: 'demo seed' });

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await handle(new Request(ORIGIN + path, { method, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return (await r.json().catch(() => ({}))) as Record<string, any>;
  };
  const reporter = async (portal: 'student' | 'guest', phone: string) => (await call('POST', '/api/auth/session', { portal, idToken: devToken({ provider: 'phone', phone, uid: `demo-${phone.slice(-4)}` }) })).token as string;
  const admin = (await call('POST', '/api/staff/session', { idToken: devToken({ provider: 'google.com', email: DEMO_ACCOUNTS.admin.email }) })).token as string;
  const day = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
  const complaint = (o: Record<string, string>) => ({ category: 'Other', description: `${o.itemName} reported lost on campus`, colorFeatures: 'See description', lostTime: '', ownershipEvidence: 'Private detail only the owner knows (demo)', idempotencyKey: crypto.randomUUID(), elapsedMs: 15000, website: '', lostDate: day(1), ...o });
  const found = async (o: Record<string, string>, hue: number) => {
    const photo = await sampleImage(o.itemName, hue);
    return (await call('POST', '/api/staff/found-items', { privateDetails: '', foundTime: '', foundDate: day(1), photos: photo ? [{ mime: 'image/jpeg', dataBase64: photo }] : [], ...o }, admin)).itemId as string;
  };

  const tok = await Promise.all(STUDENTS.map((s) => reporter('student', s.phone)));
  const guest = await reporter('guest', DEMO_ACCOUNTS.guest.phone);
  const [aarav, diya, rohan, sneha, kabir, ananya] = tok;

  // Completed example: water bottle returned
  const c1 = (await call('POST', '/api/me/complaints', complaint({ category: 'Water Bottle / Lunch Box', itemName: 'Steel water bottle', description: 'Silver steel bottle with a green lid and a NASA sticker', colorFeatures: 'Silver, green lid', lastSeenLocation: 'Central Library, 2nd floor', ownershipEvidence: 'Initials D.P. engraved at the bottom' }), diya)).complaintId;
  const f1 = await found({ category: 'Water Bottle / Lunch Box', itemName: 'Steel water bottle', publicDescription: 'Silver bottle with green lid found in library', privateDetails: 'Engraved D.P.', colorFeatures: 'Silver', foundLocation: 'Central Library', storageLocation: 'Shelf A1' }, 150);
  await call('POST', `/api/staff/complaints/${c1}/propose-match`, { itemId: f1 }, admin);
  const cl1 = (await call('POST', `/api/me/complaints/${c1}/claim`, { itemId: f1, evidence: 'My initials D.P. are engraved at the bottom of the bottle' }, diya)).claimId;
  await call('POST', `/api/staff/claims/${cl1}/decision`, { decision: 'approve', notes: 'Engraving matches private details', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, admin);
  const h1 = await call('POST', '/api/staff/handovers', { claimId: cl1, receiverType: 'owner', receiverName: 'Diya Patel', receiverIdType: 'College ID card', receiverIdLast4: '0012' }, admin);
  await call('POST', `/api/me/handovers/${h1.handoverId}/acknowledge`, { code: h1.code, signatureName: 'Diya Patel', accept: true }, diya);
  const proof = await sampleImage('Handover at counter', 190);
  if (proof) await call('POST', `/api/staff/handovers/${h1.handoverId}/evidence`, { kind: 'handover_photo', mime: 'image/jpeg', dataBase64: proof, caption: 'Item handed over at Student Affairs counter' }, admin);
  await call('POST', `/api/staff/handovers/${h1.handoverId}/release`, { confirmPhysicalRelease: true }, admin);

  // Ready for collection: ID card
  const c2 = (await call('POST', '/api/me/complaints', complaint({ category: 'ID Card / Documents', itemName: 'College ID card', description: 'College ID card in a red lanyard', colorFeatures: 'Red lanyard', lastSeenLocation: 'Main canteen' }), rohan)).complaintId;
  const f2 = await found({ category: 'ID Card / Documents', itemName: 'ID card with red lanyard', publicDescription: 'College ID card on a red lanyard', privateDetails: 'Name and roll number on card', colorFeatures: 'Red', foundLocation: 'Main canteen', storageLocation: 'Drawer 2' }, 0);
  await call('POST', `/api/staff/complaints/${c2}/propose-match`, { itemId: f2 }, admin);
  const cl2 = (await call('POST', `/api/me/complaints/${c2}/claim`, { itemId: f2, evidence: 'The card shows my name Rohan Verma and roll 21MEC033' }, rohan)).claimId;
  await call('POST', `/api/staff/claims/${cl2}/decision`, { decision: 'approve', notes: 'Name and roll number match', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, admin);

  // Potential match: umbrella; Ownership verification pending: headphones
  const c3 = (await call('POST', '/api/me/complaints', complaint({ category: 'Other', itemName: 'Blue umbrella', description: 'Blue foldable umbrella with a wooden handle', colorFeatures: 'Blue, wooden handle', lastSeenLocation: 'Auditorium entrance' }), sneha)).complaintId;
  const f3 = await found({ category: 'Other', itemName: 'Blue umbrella', publicDescription: 'Blue umbrella found near auditorium', privateDetails: 'Wooden handle with a scratch', colorFeatures: 'Blue', foundLocation: 'Auditorium', storageLocation: 'Rack U' }, 220);
  await call('POST', `/api/staff/complaints/${c3}/propose-match`, { itemId: f3 }, admin);
  const c4 = (await call('POST', '/api/me/complaints', complaint({ category: 'Electronics', itemName: 'Wireless headphones', description: 'Black over-ear wireless headphones in a grey case', colorFeatures: 'Black, grey case', lastSeenLocation: 'Seminar Hall B' }), kabir)).complaintId;
  const f4 = await found({ category: 'Electronics', itemName: 'Black headphones', publicDescription: 'Black wireless headphones in a case', privateDetails: 'Case has a name tag K.S.', colorFeatures: 'Black', foundLocation: 'Seminar Hall B', storageLocation: 'Locker 3' }, 260);
  await call('POST', `/api/staff/complaints/${c4}/propose-match`, { itemId: f4 }, admin);
  await call('POST', `/api/me/complaints/${c4}/claim`, { itemId: f4, evidence: 'The case has a name tag with K.S. and a small dent on the left cup' }, kabir);

  // Open reports (dashboard, hotspots, guest)
  await call('POST', '/api/me/complaints', complaint({ category: 'Wallet / Purse', itemName: 'Brown leather wallet', description: 'Brown leather wallet with a metro card', colorFeatures: 'Brown', lastSeenLocation: 'Central Library, 2nd floor' }), aarav);
  await call('POST', '/api/me/complaints', complaint({ category: 'Books / Stationery', itemName: 'Engineering drawing kit', description: 'Drawing kit in a black zip case', colorFeatures: 'Black case', lastSeenLocation: 'Block C, room 204' }), ananya);
  await call('POST', '/api/me/complaints', complaint({ category: 'Keys', itemName: 'Car keys with remote', description: 'Car keys with a blue remote and a temple keychain', colorFeatures: 'Blue remote', lastSeenLocation: 'Visitor parking', guestName: DEMO_ACCOUNTS.guest.name, visitInfo: 'Parents meeting, Admin Block' }), guest);
  await call('POST', '/api/me/complaints', complaint({ category: 'Bag / Backpack', itemName: 'Grey backpack', description: 'Grey backpack with a laptop sleeve', colorFeatures: 'Grey', lastSeenLocation: 'Main canteen' }), ananya);
  await found({ category: 'Electronics', itemName: 'Phone charger', publicDescription: 'White USB-C phone charger', colorFeatures: 'White', foundLocation: 'Central Library', storageLocation: 'Box E' }, 40);
  await found({ category: 'Clothing', itemName: 'Navy hoodie', publicDescription: 'Navy hoodie, size M', colorFeatures: 'Navy', foundLocation: 'Sports complex', storageLocation: 'Rack C' }, 230);

  // Spread sample records over recent weeks so trends and analytics look realistic.
  const spread = (rows: Record<string, string>[], dateCol?: string) => rows.forEach((r, i) => {
    const d = new Date(Date.now() - ((i * 37) % 40 + 1) * 86400e3 - (i % 7) * 3600e3).toISOString();
    if (r.status === 'Returned' || r.status === 'Ready for Collection' || r.status === 'Potential Match' || r.status === 'Ownership Verification') return;
    r.created_at = d; r.updated_at = d;
    if (dateCol) r[dateCol] = d.slice(0, 10);
  });
  spread(store.tables.Complaints, 'lost_date');
  spread(store.tables.Found_Items, 'found_date');
}
