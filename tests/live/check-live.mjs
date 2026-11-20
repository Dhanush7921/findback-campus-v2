// Post-deploy browser check of the live Pages site: SPA deep links, client navigation, assets, console errors.
import { chromium } from 'playwright';
const U = process.argv[2] || process.env.LIVE_URL;
if (!U) throw new Error('usage: node tests/live/check-live.mjs <url>');
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const p = await b.newPage();
const errors = [], bad = [];
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
// Pages serves SPA deep links via 404.html with status 404; only flag failing sub-resources.
p.on('response', (r) => { if (r.status() >= 400 && r.request().resourceType() !== 'document') bad.push(`${r.status()} ${r.url()}`); });
const h1 = async () => { await p.locator('main, h1').first().waitFor({ timeout: 15000 }); const h = p.locator('h1'); return (await h.count()) ? (await h.first().innerText()).trim() : (await p.locator('body').innerText()).trim().split('\n')[0]; };
const results = [];
for (const path of ['', 'how-it-works', 'student', 'guest', 'help', 'privacy', 'staff', 'management']) {
  await p.goto(U + path, { waitUntil: 'networkidle' });
  results.push(`/${path} -> ${await h1()}`);
}
await p.goto(U, { waitUntil: 'networkidle' });
await p.locator('main a[href$="/guest"]').first().click();
await p.waitForURL(/\/guest$/);
results.push(`client nav -> ${p.url()}`);
// Live CEO demo: Explore Demo -> each role signs in one-click on the in-browser demo engine.
const demoApiHits = [];
p.on('request', (r) => { if (/run\.app|googleapis|firebase|identitytoolkit/.test(r.url())) demoApiHits.push(r.url()); });
await p.goto(U, { waitUntil: 'networkidle' });
await p.getByTestId('explore-demo').click();
await p.waitForURL(/\/demo$/);
for (const [role, landing, text] of [['student', /\/me$/, 'Brown leather wallet'], ['guest', /\/me$/, 'car keys'], ['admin', /\/staff$/, 'Dashboard'], ['management', /\/management$/, '']]) {
  await p.goto(U + 'demo', { waitUntil: 'networkidle' });
  await p.getByTestId(`demo-${role}`).getByRole('button', { name: /Enter demo as/ }).click();
  await p.waitForURL(landing, { timeout: 20000 });
  await p.getByTestId('demo-banner').getByText('DEMO MODE — SAMPLE DATA ONLY').waitFor({ timeout: 10000 });
  if (text) await p.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
  await p.screenshot({ path: `live-demo-${role}.png`, fullPage: false });
  results.push(`demo ${role} -> ${p.url()}`);
}
await p.goto(U + 'demo', { waitUntil: 'networkidle' });
const card = p.getByTestId('demo-admin');
await card.getByLabel('Username').fill('admin@demo.findback');
await card.getByLabel('Password').fill('Admin@123');
await card.getByRole('button', { name: 'Sign in' }).click();
await p.waitForURL(/\/staff$/, { timeout: 20000 });
results.push(`demo typed credentials -> ${p.url()}`);
results.push(`demo requests to real backend: ${demoApiHits.length}`);
console.log(results.join('\n'));
if (demoApiHits.length) { console.error('demo reached a real backend:', demoApiHits); process.exit(1); }
// API errors are expected until the backend is configured; report them separately.
const apiErr = errors.filter((e) => /fetch|api|network/i.test(e));
// Deep links load 404.html (status 404) by design; failing sub-resources are tracked separately below.
const appErr = errors.filter((e) => !apiErr.includes(e) && !/^Failed to load resource/.test(e));
console.log('api-related console errors (backend not configured yet is expected):', apiErr.length);
console.log('app console errors:', JSON.stringify(appErr.map((e) => e.slice(0, 200))));
console.log('failed sub-resources:', JSON.stringify(bad));
await b.close();
if (appErr.length || bad.filter((x) => !/\/api\//.test(x)).length) process.exit(1);
