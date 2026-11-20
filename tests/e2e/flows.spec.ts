// End-to-end: built site → real API code (dev sign-in, in-memory store). Run: npm run build:e2e && npx playwright test
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8787';
const ORIGIN = 'http://127.0.0.1:4173';
const STUDENT = '+919876543210';
const dev = (d: object) => 'dev.' + Buffer.from(JSON.stringify(d)).toString('base64');

async function api(rq: APIRequestContext, method: 'GET' | 'POST', path: string, token?: string, data?: unknown) {
  const r = await rq.fetch(API + path, { method, data, headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: r.status(), json: await r.json().catch(() => ({})) };
}

async function phoneLogin(page: Page, portal: 'student' | 'guest', phone: string) {
  await page.goto(portal);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/me$/);
}

async function report(page: Page, item: string) {
  await page.goto('me/report');
  await page.getByLabel('Category').selectOption('Bag / Backpack');
  await page.getByLabel('Item name').fill(item);
  await page.getByLabel('Description').fill('Black backpack with a laptop sleeve and two front pockets');
  await page.getByLabel('Colour & distinguishing features').fill('Black with red zipper pulls');
  await page.getByLabel('Last seen location').fill('Central library, second floor');
  await page.getByLabel('Date lost').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Private ownership evidence').fill('Green notebook inside with my roll number on the cover');
  await page.locator('input[type=checkbox]').last().check();
  await page.waitForTimeout(3200); // anti-bot minimum fill time
  await page.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(page).toHaveURL(/\/me\/complaints\/FB-/, { timeout: 20000 });
  return page.url().split('/').pop()!;
}

test('home shows the four portals @mobile', async ({ page }) => {
  await page.goto('');
  for (const p of ['student', 'guest', 'staff', 'management']) await expect(page.locator(`main a[href$="/${p}"]`).first()).toBeVisible();
});

test('unregistered phone cannot use the student portal', async ({ page }) => {
  await page.goto('student');
  await page.getByLabel('Mobile number').fill('+919000000123');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByRole('alert').or(page.locator('[role=status]')).first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/me$/);
});

test('student report → match → claim → receiver acknowledgment → staff release → Returned', async ({ page, request }) => {
  await phoneLogin(page, 'student', STUDENT);
  const cid = await report(page, 'Black backpack E2E');
  await expect(page.getByText(cid).first()).toBeVisible();
  await expect(page.getByText('Asha Reddy').first()).toBeVisible();

  const admin = (await api(request, 'POST', '/api/staff/session', undefined, { idToken: dev({ provider: 'google.com', email: 'clerk@college.edu' }) })).json.token;
  const stu = (await api(request, 'POST', '/api/auth/session', undefined, { portal: 'student', idToken: dev({ provider: 'phone', phone: STUDENT }) })).json.token;
  const fi = await api(request, 'POST', '/api/staff/found-items', admin, { category: 'Bag / Backpack', itemName: 'Black backpack', publicDescription: 'Black backpack found near reading hall', privateDetails: 'Green notebook inside', colorFeatures: 'Black', foundLocation: 'Central library', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Shelf A2' });
  expect(fi.status).toBe(201);
  expect((await api(request, 'POST', `/api/staff/complaints/${cid}/propose-match`, admin, { itemId: fi.json.itemId })).status).toBe(200);
  const claim = await api(request, 'POST', `/api/me/complaints/${cid}/claim`, stu, { itemId: fi.json.itemId, evidence: 'Green notebook with my roll number inside the front pocket' });
  expect(claim.status).toBe(201);
  expect((await api(request, 'POST', `/api/staff/claims/${claim.json.claimId}/decision`, admin, { decision: 'approve', notes: 'Evidence matches', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } })).status).toBe(200);
  const start = await api(request, 'POST', '/api/staff/handovers', admin, { claimId: claim.json.claimId, receiverType: 'owner', receiverName: 'Asha Reddy', receiverIdType: 'College ID card', receiverIdLast4: '0104' });
  expect(start.status).toBe(201);

  await page.goto('me/acknowledge');
  await page.getByLabel('Code shown at the counter').fill(start.json.code);
  await page.getByLabel('Type your full name as signature').fill('Asha Reddy');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText('Receipt confirmed').first()).toBeVisible();

  // Not Returned until staff releases
  expect((await api(request, 'GET', `/api/me/complaints/${cid}`, stu)).json.complaint.status).toBe('Awaiting Receiver Confirmation');
  expect((await api(request, 'POST', `/api/staff/handovers/${start.json.handoverId}/release`, admin, { confirmPhysicalRelease: true })).status).toBe(200);
  await page.goto(`me/complaints/${cid}`);
  await expect(page.getByText('Returned').first()).toBeVisible();
});

test('management portal is read-only and loads analytics', async ({ page, request }) => {
  await page.goto('management');
  await page.getByLabel('Development email').fill('dean@college.edu');
  await page.getByRole('button', { name: 'Development sign-in' }).click();
  await expect(page).toHaveURL(/\/management/);
  await expect(page.locator('main')).toContainText(/complaint/i, { timeout: 15000 });
  const mg = (await api(request, 'POST', '/api/staff/session', undefined, { idToken: dev({ provider: 'google.com', email: 'dean@college.edu' }) })).json.token;
  expect((await api(request, 'POST', '/api/staff/found-items', mg, {})).status).toBe(403);
});

// ---------- Proof uploads (found items, handover, management read-only) ----------
import zlib from 'node:zlib';
function png(w = 64, h = 48, rgb = [20, 160, 140]) {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.from([0, ...Array.from({ length: w }, () => rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function staffLogin(page: Page, email: string, portal = 'staff') {
  await page.goto(portal);
  await page.getByLabel('Development email').fill(email);
  await page.getByRole('button', { name: 'Development sign-in' }).click();
  await expect(page.getByRole('button', { name: 'Development sign-in' })).toBeHidden({ timeout: 15000 });
}

test('admin registers a found item with camera + gallery photos, previews, private evidence register @mobile', async ({ page }) => {
  await staffLogin(page, 'clerk@college.edu');
  await page.goto('staff/register');
  await page.getByLabel('Category').selectOption('Bag / Backpack');
  await page.getByLabel('Item name').fill('Blue umbrella E2E');
  await page.getByLabel('Public description').fill('Blue folding umbrella found near canteen');
  await page.getByLabel('Colour & features').fill('Blue');
  await page.getByLabel('Found location').fill('Canteen');
  await page.getByLabel('Storage location').fill('Shelf B1');
  await expect(page.getByTestId('evidence-camera')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('evidence-camera').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: png() });
  await page.getByTestId('evidence-gallery').setInputFiles([{ name: 'g1.png', mimeType: 'image/png', buffer: png(80, 60, [200, 40, 40]) }, { name: 'g2.png', mimeType: 'image/png', buffer: png(30, 30, [40, 40, 200]) }]);
  await expect(page.getByTestId('evidence-previews').locator('img')).toHaveCount(3);
  await page.getByLabel('Remove file 3').click();
  await expect(page.getByTestId('evidence-previews').locator('img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Register item' }).click();
  await expect(page).toHaveURL(/staff\/inventory\/FI-/, { timeout: 30000 });
  const gallery = page.getByTestId('evidence-found_item');
  await expect(gallery.locator('li')).toHaveCount(2);
  await expect(gallery).toContainText('clerk@college.edu');
  await expect(gallery.locator('img').first()).toBeVisible();
});

test('counter handover: proof of handover document + photo, release only after receiver confirmation, management read-only view', async ({ page, request, browser }) => {
  const admin = (await api(request, 'POST', '/api/staff/session', undefined, { idToken: dev({ provider: 'google.com', email: 'clerk@college.edu' }) })).json.token;
  const stu = (await api(request, 'POST', '/api/auth/session', undefined, { portal: 'student', idToken: dev({ provider: 'phone', phone: '+919811112222' }) })).json.token;
  const sub = await api(request, 'POST', '/api/me/complaints', stu, { category: 'Wallet / Purse', itemName: 'Brown wallet', description: 'Brown leather wallet with college ID inside', colorFeatures: 'Brown', lastSeenLocation: 'Library', lostDate: new Date().toISOString().slice(0, 10), lostTime: '', ownershipEvidence: 'Has a metro card and two photos inside', idempotencyKey: crypto.randomUUID(), elapsedMs: 15000, website: '' });
  expect(sub.status).toBe(201);
  const cid = sub.json.complaintId;
  const fi = await api(request, 'POST', '/api/staff/found-items', admin, { category: 'Wallet / Purse', itemName: 'Brown wallet', publicDescription: 'Brown wallet found in library', privateDetails: 'Metro card', colorFeatures: 'Brown', foundLocation: 'Library', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Safe' });
  await api(request, 'POST', `/api/staff/complaints/${cid}/propose-match`, admin, { itemId: fi.json.itemId });
  const claim = await api(request, 'POST', `/api/me/complaints/${cid}/claim`, stu, { itemId: fi.json.itemId, evidence: 'Metro card and two passport photos inside' });
  await api(request, 'POST', `/api/staff/claims/${claim.json.claimId}/decision`, admin, { decision: 'approve', notes: 'Matches', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } });
  const start = await api(request, 'POST', '/api/staff/handovers', admin, { claimId: claim.json.claimId, receiverType: 'owner', receiverName: 'Ravi Kumar', receiverIdType: 'College ID card', receiverIdLast4: '0200' });
  expect(start.status).toBe(201);
  const ho = start.json.handoverId;

  await staffLogin(page, 'clerk@college.edu');
  await page.goto('staff/handovers');
  const row = page.locator('tr', { hasText: ho });
  await expect(row.getByRole('button', { name: 'Confirm release' })).toHaveCount(0); // not before receiver confirmation
  await row.getByRole('button', { name: 'Proof of handover' }).click();
  const panel = page.getByTestId('proof-panel');
  await expect(panel).toContainText(cid);
  await panel.getByLabel('Evidence type').selectOption('handover_document');
  await panel.getByTestId('evidence-gallery').setInputFiles({ name: 'register.pdf', mimeType: 'application/pdf', buffer: PDF });
  await panel.getByLabel('Caption').fill('Signed register page');
  await panel.getByRole('button', { name: 'Save evidence' }).click();
  await expect(panel.getByTestId('evidence-handover').locator('li')).toHaveCount(1);
  await panel.getByLabel('Evidence type').selectOption('handover_photo');
  await panel.getByTestId('evidence-camera').setInputFiles({ name: 'counter.png', mimeType: 'image/png', buffer: png() });
  await panel.getByRole('button', { name: 'Save evidence' }).click();
  await expect(panel.getByTestId('evidence-handover').locator('li')).toHaveCount(2);
  await page.keyboard.press('Escape');

  expect((await api(request, 'POST', `/api/me/handovers/${ho}/acknowledge`, stu, { code: start.json.code, signatureName: 'Ravi Kumar', accept: true, signature: { mime: 'image/png', dataBase64: png(40, 20, [0, 0, 0]).toString('base64') } })).status).toBe(200);
  await page.reload();
  await page.locator('tr', { hasText: ho }).getByRole('button', { name: 'Confirm release' }).click();
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: 'Confirm release' }).last().click();
  await expect(page.getByText('Verified').first()).toBeVisible();
  expect((await api(request, 'GET', `/api/me/complaints/${cid}`, stu)).json.complaint.status).toBe('Returned');

  // management: view-only evidence, no upload controls
  const ctx = await browser.newContext();
  const mp = await ctx.newPage();
  await staffLogin(mp, 'dean@college.edu', 'management');
  await mp.goto('management/handovers');
  await mp.locator('tr', { hasText: ho }).getByRole('button', { name: 'Evidence' }).click();
  const mg = mp.getByTestId('evidence-handover');
  await expect(mg.locator('li')).toHaveCount(3);
  await expect(mg).toContainText('Withheld');
  await expect(mp.getByTestId('evidence-gallery')).toHaveCount(0);
  await expect(mp.getByRole('button', { name: 'Save evidence' })).toHaveCount(0);
  await ctx.close();
});

test('home delivery: courier issues doorstep code, uploads proof, records completion; another admin finalises @mobile', async ({ page, request }) => {
  const boss = (await api(request, 'POST', '/api/staff/session', undefined, { idToken: dev({ provider: 'google.com', email: 'dev.admin@example.edu' }) })).json.token;
  await api(request, 'POST', '/api/staff/settings', boss, { settings: { home_delivery_enabled: 'true' } });
  const phone = `+9199${String(Date.now()).slice(-8)}`;
  const guest = (await api(request, 'POST', '/api/auth/session', undefined, { portal: 'guest', idToken: dev({ provider: 'phone', phone }) })).json.token;
  const sub = await api(request, 'POST', '/api/me/complaints', guest, { guestName: 'Visiting Parent', category: 'Electronics', itemName: 'Grey power bank', description: 'Grey 10000 mAh power bank with a cable', colorFeatures: 'Grey', lastSeenLocation: 'Auditorium', lostDate: new Date().toISOString().slice(0, 10), lostTime: '', ownershipEvidence: 'Sticker of a cat on the back side', visitInfo: 'Parents day', idempotencyKey: crypto.randomUUID(), elapsedMs: 15000, website: '' });
  expect(sub.status).toBe(201);
  const cid = sub.json.complaintId;
  const fi = await api(request, 'POST', '/api/staff/found-items', boss, { category: 'Electronics', itemName: 'Power bank', publicDescription: 'Grey power bank found in auditorium', privateDetails: 'Cat sticker', colorFeatures: 'Grey', foundLocation: 'Auditorium', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Drawer 3' });
  await api(request, 'POST', `/api/staff/complaints/${cid}/propose-match`, boss, { itemId: fi.json.itemId });
  const claim = await api(request, 'POST', `/api/me/complaints/${cid}/claim`, guest, { itemId: fi.json.itemId, evidence: 'There is a cat sticker on the back side' });
  await api(request, 'POST', `/api/staff/claims/${claim.json.claimId}/decision`, boss, { decision: 'approve', notes: 'Matches', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } });
  const start = await api(request, 'POST', '/api/staff/handovers', boss, { claimId: claim.json.claimId, receiverType: 'owner', receiverName: 'Visiting Parent', receiverIdType: 'Aadhaar', receiverIdLast4: '4321', mode: 'delivery', deliveryStaff: 'clerk@college.edu', deliveryAddress: '12 Lake View Road, Hyderabad 500001' });
  expect(start.status).toBe(201);
  const ho = start.json.handoverId;

  // courier on their phone
  await staffLogin(page, 'clerk@college.edu');
  await page.goto('staff/handovers');
  await page.locator('tr', { hasText: ho }).getByRole('button', { name: 'Proof of handover' }).click();
  const panel = page.getByTestId('proof-panel');
  await expect(panel).toContainText('12 Lake View Road'); // admin-only address
  await panel.getByRole('button', { name: 'Issue doorstep code' }).click();
  const code = (await panel.getByTestId('delivery-code').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  expect((await api(request, 'POST', `/api/me/handovers/${ho}/acknowledge`, guest, { code, signatureName: 'Visiting Parent', accept: true })).status).toBe(200);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('tr', { hasText: ho }).getByRole('button', { name: 'Proof of handover' }).click();
  await expect(panel.getByLabel('Evidence type')).toHaveValue('delivery_proof');
  await panel.getByTestId('evidence-camera').setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: png() });
  await panel.getByRole('button', { name: 'Save evidence' }).click();
  await expect(panel.getByTestId('evidence-handover').locator('li')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Record delivery completed now' }).click();
  await expect(page.getByText('Delivery recorded').first()).toBeVisible();
  expect((await api(request, 'GET', `/api/me/complaints/${cid}`, guest)).json.complaint.status).toBe('Awaiting Receiver Confirmation');

  // address never reaches management or the reporter
  const dean = (await api(request, 'POST', '/api/staff/session', undefined, { idToken: dev({ provider: 'google.com', email: 'dean@college.edu' }) })).json.token;
  expect(JSON.stringify((await api(request, 'GET', '/api/mgmt/handovers', dean)).json)).not.toContain('Lake View');
  expect(JSON.stringify((await api(request, 'GET', `/api/me/complaints/${cid}`, guest)).json)).not.toContain('Lake View');

  // staff finalisation
  expect((await api(request, 'POST', `/api/staff/handovers/${ho}/release`, boss, { confirmPhysicalRelease: true })).status).toBe(200);
  expect((await api(request, 'GET', `/api/me/complaints/${cid}`, guest)).json.complaint.status).toBe('Returned');
});
