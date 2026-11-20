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
console.log(results.join('\n'));
// API errors are expected until the backend is configured; report them separately.
const apiErr = errors.filter((e) => /fetch|api|network/i.test(e));
// Deep links load 404.html (status 404) by design; failing sub-resources are tracked separately below.
const appErr = errors.filter((e) => !apiErr.includes(e) && !/^Failed to load resource/.test(e));
console.log('api-related console errors (backend not configured yet is expected):', apiErr.length);
console.log('app console errors:', JSON.stringify(appErr.map((e) => e.slice(0, 200))));
console.log('failed sub-resources:', JSON.stringify(bad));
await b.close();
if (appErr.length || bad.filter((x) => !/\/api\//.test(x)).length) process.exit(1);
