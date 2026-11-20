// Renders public/icons/logo.svg to PNG app icons (PWA + Android/iOS sources) with the preinstalled Chromium.
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('public/icons/logo.svg', 'utf8');
const b = await chromium.launch(process.env.CI ? {} : { executablePath: process.env.CHROME_PATH_OVERRIDE || '/opt/pw-browsers/chromium' });
const p = await b.newPage();
async function render(size, out, { pad = 0, bg = 'transparent', rounded = true } = {}) {
  const inner = size - pad * 2;
  const s = rounded ? svg : svg.replace('rx="14"', 'rx="0"');
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">${s.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await p.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
await render(192, 'public/icons/icon-192.png');
await render(512, 'public/icons/icon-512.png');
await render(512, 'public/icons/icon-maskable-512.png', { rounded: false });
fs.mkdirSync('resources', { recursive: true });
await render(1024, 'resources/icon.png', { rounded: false });
await render(1024, 'resources/icon-foreground.png', { pad: 260 });
await p.setViewportSize({ width: 2732, height: 2732 });
await p.setContent(`<html><body style="margin:0;background:#f8fbfa;display:grid;place-items:center;height:2732px">${svg.replace('<svg ', '<svg width="520" height="520" ')}</body></html>`);
await p.screenshot({ path: 'resources/splash.png' });
await b.close();
console.log('icons written');
