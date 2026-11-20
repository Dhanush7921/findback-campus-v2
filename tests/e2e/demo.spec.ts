import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const shots = resolve('docs/screenshots');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABFaP0WAAAADUlEQVR42mNk+M/wHwAF/gL+uKI4WQAAAABJRU5ErkJggg==', 'base64');

async function signIn(page: import('@playwright/test').Page, role: string) {
  await page.goto(`demo/${role}`);
  await page.getByRole('button', { name: new RegExp(`Enter ${role === 'admin' ? 'Main Admin' : role}`, 'i') }).click();
}

async function changeRole(page: import('@playwright/test').Page, role: string) {
  await page.evaluate(() => sessionStorage.removeItem('findback-v2-demo-auth-v1'));
  await signIn(page, role);
}

test('public demo role workflows and screenshots', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('.');
  await page.evaluate(() => { localStorage.removeItem('findback-v2-demo-data-v1'); sessionStorage.clear(); });
  await page.reload();
  await expect(page.getByRole('link', { name: /Launch interactive demo/i })).toBeVisible();
  await page.screenshot({ path: `${shots}/01-homepage.png`, fullPage: true });

  await page.goto('demo/student');
  await expect(page.getByRole('heading', { name: /Continue as Aarav Kumar/i })).toBeVisible();
  await page.screenshot({ path: `${shots}/02-student-login.png`, fullPage: true });
  await page.getByRole('button', { name: /Enter Student demo/i }).click();
  await expect(page.getByRole('heading', { name: /Welcome, Aarav/i })).toBeVisible();
  await page.screenshot({ path: `${shots}/04-student-dashboard.png`, fullPage: true });

  await page.getByRole('button', { name: /Report lost item/i }).click();
  await page.getByLabel('Item name').fill('Demo wireless earbuds');
  await page.getByLabel('Category').selectOption('Electronics');
  await page.getByLabel('Last seen location').fill('Innovation Centre lobby');
  await page.getByLabel('Private description').fill('The case has a tiny yellow star sticker underneath.');
  await page.getByRole('button', { name: /Submit demo complaint/i }).click();
  await expect(page.getByText(/was created in demo mode/i)).toBeVisible();

  await page.getByRole('button', { name: /Handover proof/i }).click();
  await page.getByLabel('Receiver proof image').setInputFiles({ name: 'receiver-proof.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByAltText('Receiver proof preview')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Upload proof & acknowledge/i }).click();
  await expect(page.getByText(/Awaiting separate physical ID check/i)).toBeVisible();
  await page.screenshot({ path: `${shots}/08-handover-proof.png`, fullPage: true });

  await changeRole(page, 'guest');
  await expect(page.getByRole('heading', { name: /Welcome, Maya/i })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('findback-v2-demo-auth-v1'));
  await page.goto('demo/guest');
  await page.screenshot({ path: `${shots}/03-guest-login.png`, fullPage: true });
  await page.getByRole('button', { name: /Enter Guest demo/i }).click();
  await expect(page.getByText('FB-DEMO-2001')).toBeVisible();

  await changeRole(page, 'admin');
  await expect(page.getByRole('heading', { name: /Campus recovery operations/i })).toBeVisible();
  await page.screenshot({ path: `${shots}/05-main-admin.png`, fullPage: true });
  await page.getByRole('button', { name: /Register found item/i }).click();
  await page.getByLabel('Item name').fill('Demo black umbrella');
  await page.getByLabel('Found location').fill('Canteen entrance');
  await page.getByLabel('Secure storage location').fill('Cabinet B · Shelf 1');
  await page.getByLabel('Found item photo').setInputFiles({ name: 'found-item.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByAltText('Found item preview')).toBeVisible();
  await page.screenshot({ path: `${shots}/07-found-item-upload.png`, fullPage: true });
  await page.getByRole('button', { name: /Simulate upload & register/i }).click();
  await expect(page.getByText(/registered with its mock photo/i)).toBeVisible();
  await page.getByRole('button', { name: /^Handovers$/i }).click();
  await expect(page.getByAltText('Uploaded receiver handover proof')).toBeVisible();
  await page.getByLabel(/physically checked/i).check();
  await page.getByRole('button', { name: /Complete staff release/i }).click();
  await expect(page.getByText('completed', { exact: true })).toBeVisible();

  await changeRole(page, 'management');
  await expect(page.getByRole('heading', { name: /Institutional overview/i })).toBeVisible();
  await expect(page.getByText(/Strictly read-only/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Register found item/i })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/06-management.png`, fullPage: true });

  expect(errors).toEqual([]);
});
