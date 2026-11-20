// HTTP load test with autocannon. Reports measured numbers only.
//   Local (default): starts the dev stack (real API code, in-memory store) on :8799 and measures read paths.
//   Live: node tests/load/run-load.mjs --target https://<cloud-run-url>   (read-only: health + public config)
// Write capacity against Sheets is modelled separately by `npm run bench:sheets`.
import autocannon from 'autocannon';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const duration = Number(arg('--duration', 10));
let base = arg('--target');
const local = !base;
const headers = { origin: local ? 'http://127.0.0.1:8798' : 'https://dhanush7921.github.io' };
let token;
if (!base) {
  process.env.API_PORT = '8799'; process.env.WEB_PORT = '8798'; process.env.DIST = '/nonexistent';
  const out = path.resolve('node_modules/.tmp/dev-stack-load.mjs');
  await build({ entryPoints: ['server/dev.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  const orig = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('{"severity"')) return; orig(...a); };
  await import(pathToFileURL(out).href);
  base = 'http://127.0.0.1:8799';
  const r = await fetch(base + '/api/auth/session', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'student', idToken: 'dev.' + Buffer.from(JSON.stringify({ provider: 'phone', phone: '+919876543210' })).toString('base64') }) });
  token = (await r.json()).token;
}
const scenarios = [['health', '/api/health', {}], ['public config', '/api/public/config', {}]];
if (token) scenarios.push(['student: my complaints (auth + registry check)', '/api/me/complaints', { authorization: `Bearer ${token}` }]);
const rows = [];
for (const [name, p, h] of scenarios) for (const connections of [10, 50]) {
  let n = 0; // local: spread simulated clients over many IPs so the per-IP limiter (900/min) does not dominate
  const requests = local ? [{ setupRequest: (req) => ({ ...req, headers: { ...req.headers, 'x-forwarded-for': `10.1.${(n >> 8) & 255}.${n++ & 255}` } }) }] : undefined;
  const r = await autocannon({ url: base + p, connections, duration, headers: { ...headers, ...h }, requests });
  const row = { scenario: name, connections, rps: Math.round(r.requests.average), p50_ms: r.latency.p50, p99_ms: r.latency.p99, non2xx: r.non2xx, errors: r.errors + r.timeouts };
  rows.push(row); console.log(JSON.stringify(row));
}
console.table(rows);
process.exit(0);
