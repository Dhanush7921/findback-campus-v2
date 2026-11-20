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
