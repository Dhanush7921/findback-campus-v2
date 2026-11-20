// In-process capacity estimate for the Cloud Run design: real API code + SheetsStore against a fake Google API
// with MODELLED latency (Sheets write ≈ 500 ms, read ≈ 300 ms). Not a measurement of Google's servers.
// Run: npm run bench:sheets
import { createApp } from '../../api/src/app';
import { SheetsStore } from '../../api/src/store/sheets';
import { createFakeGoogle } from '../gcp/fake-google';

const g = createFakeGoogle();
const slow: typeof fetch = async (u, i) => { await new Promise((r) => setTimeout(r, i?.method === 'POST' || i?.method === 'PUT' ? 500 : 300)); return g.fetchImpl(u, i); };
const store = new SheetsStore('s', 'b', async () => 't', { fetchImpl: slow, autoMigrate: true });
const env = { APP_ENV: 'development' as const, DEV_AUTH: '1', HASH_PEPPER: 'p'.repeat(32), SESSION_KEY: 'k'.repeat(32), ALLOWED_ORIGINS: 'https://x.test' };
const app = createApp({ env, store });
console.log = ((orig) => (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('{"')) return; orig(...a); })(console.log);
let ipn = 0;
const call = (path: string, body?: unknown, token?: string) => app(new Request(`https://api${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { origin: 'https://x.test', 'content-type': 'application/json', 'x-forwarded-for': `10.${(ipn >> 8) & 255}.${ipn++ & 255}.1`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));
const dev = (d: object) => 'dev.' + Buffer.from(JSON.stringify(d)).toString('base64');
const complaint = () => ({ guestName: 'Load Test', category: 'Bag / Backpack', itemName: 'Black backpack', description: 'Black backpack with a laptop sleeve and two front pockets',
  colorFeatures: 'Black', lastSeenLocation: 'Central library', lostDate: new Date().toISOString().slice(0, 10), lostTime: '13:15',
  ownershipEvidence: 'Green notebook inside with my roll number', visitInfo: 'Seminar visit', idempotencyKey: crypto.randomUUID(), elapsedMs: 15000, website: '' });

async function run(label: string, n: number, conc: number, fn: (i: number) => Promise<Response>) {
  const lat: number[] = []; let ok = 0, i = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; const s = Date.now(); const r = await fn(k); await r.arrayBuffer(); lat.push(Date.now() - s); if (r.status < 400) ok++; } }));
  const secs = (Date.now() - t0) / 1000; lat.sort((a, b) => a - b);
  console.log(`${label}: ${n} req, conc ${conc}: ${(n / secs).toFixed(1)} req/s, ok ${ok}, p50 ${lat[Math.floor(n / 2)]} ms, p95 ${lat[Math.floor(n * 0.95)]} ms`);
}
await call('/api/health');
const tokens: string[] = [];
await run('guest sign-in (registry write)', 60, 20, async (k) => {
  const r = await call('/api/auth/session', { portal: 'guest', idToken: dev({ provider: 'phone', phone: `+9199000${String(k).padStart(5, '0')}` }) });
  if (r.status === 200) tokens.push(((await r.clone().json()) as { token: string }).token);
  return r;
});
await run('submit complaint (write)', 60, 20, (k) => call('/api/me/complaints', complaint(), tokens[k % tokens.length]));
await run('my complaints (cached read)', 1000, 50, (k) => call('/api/me/complaints', undefined, tokens[k % tokens.length]));
await run('public config (read)', 2000, 100, () => call('/api/public/config'));
