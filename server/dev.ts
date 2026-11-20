// Local development / E2E stack: real API code + in-memory store with development sign-in.
// Never used on Cloud Run (server/main.ts forces APP_ENV=production there).
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../api/src/app';
import { MemoryStore } from '../api/src/store/memory';
import { seed } from '../api/test/helpers';

const API_PORT = Number(process.env.API_PORT ?? 8787);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4173);
const BASE = process.env.WEB_BASE ?? '/findback-campus-v2/';
const DIST = path.resolve(process.env.DIST ?? 'dist');

const store = new MemoryStore();
seed(store);
const handle = createApp({
  env: {
    APP_ENV: 'development', DEV_AUTH: '1', DATA_ENV: 'staging',
    HASH_PEPPER: 'dev-pepper-0123456789abcdef', SESSION_KEY: 'dev-session-key-0123456789abcd',
    ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT},http://localhost:5173,http://127.0.0.1:5173`,
    BOOTSTRAP_ADMINS: 'dev.admin@example.edu',
  },
  store,
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const method = req.method ?? 'GET';
  const r = await handle(new Request(`http://127.0.0.1:${API_PORT}${req.url}`, { method, headers, body: chunks.length && method !== 'GET' ? Buffer.concat(chunks) : undefined }));
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h).end(Buffer.from(await r.arrayBuffer()));
}).listen(API_PORT, '127.0.0.1', () => console.log(`dev API http://127.0.0.1:${API_PORT}`));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
if (fs.existsSync(DIST)) {
  createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(302, { location: BASE }).end(); return; }
    let file = path.join(DIST, url.slice(BASE.length));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  }).listen(WEB_PORT, '127.0.0.1', () => console.log(`dev web http://127.0.0.1:${WEB_PORT}${BASE}`));
}
