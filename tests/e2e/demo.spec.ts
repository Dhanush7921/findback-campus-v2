// CEO demo: full Student → Admin → Receiver → Management flow on the in-browser demo engine, plus manual edits.
import { expect, test, type Page } from '@playwright/test';
import zlib from 'node:zlib';

function png(w = 64, h = 48, rgb = [20, 160, 140]) {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.from([0, ...Array.from({ length: w }, () => rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function asRole(page: Page, role: 'student' | 'guest' | 'admin' | 'management') {
  await page.goto('demo');
  await page.getByTestId(`demo-${role}`).getByRole('button', { name: /Enter demo as/ }).click();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page).toHaveURL(role === 'admin' ? /\/staff$/ : role === 'management' ? /\/management$/ : /\/me$/, { timeout: 15000 });
}

test('demo: calculator from report to Returned, management updates, no real API traffic @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const apiHits: string[] = [];
  page.on('request', (r) => { if (/:8787|run\.app|googleapis|firebase/.test(r.url())) apiHits.push(r.url()); });

  await page.goto('');
  await page.getByTestId('explore-demo').click();
  await expect(page).toHaveURL(/\/demo$/);
  // typed credentials (wrong then right)
  const card = page.getByTestId('demo-student');
  await card.getByLabel('Username').fill('student@demo.findback');
  await card.getByLabel('Password').fill('wrong');
  await card.getByRole('button', { name: 'Sign in' }).click();
  await expect(card.getByRole('alert')).toContainText('Incorrect');
  await card.getByLabel('Password').fill('Student@123');
  await card.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/me$/);
  apiHits.length = 0; // the public home page may fetch real config before demo starts; from here on nothing may reach it
  await expect(page.getByTestId('demo-banner')).toContainText('DEMO MODE — SAMPLE DATA ONLY');
  await expect(page.getByText('Brown leather wallet')).toBeVisible(); // seeded record

  // 1. Student reports calculator
  await page.goto('me/report');
  await page.getByLabel('Category').selectOption('Electronics');
  await page.getByLabel('Item name').fill('Scientific calculator');
  await page.getByLabel('Description').fill('Casio fx-991EX calculator with a blue slide cover');
  await page.getByLabel('Colour & distinguishing features').fill('Black with blue cover');
  await page.getByLabel('Last seen location').fill('Block C, room 204');
  await page.getByLabel('Date lost').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Private ownership evidence').fill('My name label is under the battery cover');
  await page.locator('input[type=checkbox]').last().check();
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(page).toHaveURL(/\/me\/complaints\/FB-/, { timeout: 20000 });
  const cid = page.url().split('/').pop()!;

  // 2. Admin registers found calculator with photos and links it
  await asRole(page, 'admin');
  await page.goto('staff/complaints');
  await expect(page.getByText(cid)).toBeVisible();
  await page.goto('staff/register');
  await page.getByLabel('Category').selectOption('Electronics');
  await page.getByLabel('Item name').fill('Calculator');
  await page.getByLabel('Public description').fill('Scientific calculator found in Block C');
  await page.getByLabel('Private verification details').fill('Name label under battery cover');
  await page.getByLabel('Colour & features').fill('Black, blue cover');
  await page.getByLabel('Found location').fill('Block C, room 204');
  await page.getByLabel('Storage location').fill('Shelf A3');
  await page.getByTestId('evidence-camera').setInputFiles({ name: 'calc.png', mimeType: 'image/png', buffer: png() });
  await page.getByTestId('evidence-gallery').setInputFiles([{ name: 'b.png', mimeType: 'image/png', buffer: png(60, 60, [10, 10, 200]) }, { name: 'c.png', mimeType: 'image/png', buffer: png(50, 30, [200, 10, 10]) }]);
  await expect(page.getByTestId('evidence-previews').locator('img')).toHaveCount(3);
  await page.getByRole('button', { name: 'Register item' }).click();
  await expect(page).toHaveURL(/staff\/inventory\/FI-/, { timeout: 20000 });
  await expect(page.getByTestId('evidence-found_item').locator('li')).toHaveCount(3);
  await page.goto(`staff/complaints/${cid}`);
  await page.locator('li', { hasText: 'Calculator' }).getByRole('button', { name: 'Propose' }).click();
  await expect(page.getByText('Proposed to student')).toBeVisible();

  // 3. Student sees match and submits evidence
  await asRole(page, 'student');
  await page.goto(`me/complaints/${cid}`);
  await page.getByRole('button', { name: 'This is mine — submit evidence' }).click();
  await page.getByLabel('Private ownership evidence').fill('My name Aarav Sharma is on a label under the battery cover');
  await page.getByRole('dialog').getByRole('button').filter({ hasText: /submit|send/i }).last().click();
  await expect(page.getByText('Ownership Verification').first()).toBeVisible();

  // 4. Admin verifies claim and starts handover (demo code)
  await asRole(page, 'admin');
  await page.goto('staff/claims');
  const claim = page.locator('.card', { hasText: cid }).first();
  await expect(claim.getByRole('checkbox')).toHaveCount(3);
  for (const cb of await claim.locator('input[type=checkbox]').all()) await cb.check();
  await claim.getByLabel('Decision notes').fill('Name label matches private details');
  await claim.getByRole('button', { name: 'Approve claim' }).click();
  await expect(page.getByText('Claim approved').first()).toBeVisible();
  await page.goto('staff/handovers');
  await page.locator('tr', { hasText: cid }).getByRole('button', { name: 'Start handover' }).click();
  await page.getByLabel('Last 4 of ID').fill('0045');
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Issue one-time code' }).click();
  await expect(page.getByTestId('demo-code-label')).toBeVisible();
  const code = (await page.locator('p.font-mono.text-5xl').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);

  // 5. Receiver acknowledges with the code
  await asRole(page, 'student');
  await page.goto('me/acknowledge');
  await page.getByLabel('Code shown at the counter').fill(code);
  await page.getByLabel('Type your full name as signature').fill('Aarav Sharma');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText('Receipt confirmed').first()).toBeVisible();

  // 6. Admin uploads proof and confirms physical release
  await asRole(page, 'admin');
  await page.goto('staff/handovers');
  const row = page.locator('tr', { hasText: cid });
  await row.getByRole('button', { name: 'Proof of handover' }).click();
  const panel = page.getByTestId('proof-panel');
  await panel.getByTestId('evidence-camera').setInputFiles({ name: 'counter.png', mimeType: 'image/png', buffer: png() });
  await panel.getByRole('button', { name: 'Save evidence' }).click();
  await expect(panel.getByTestId('evidence-handover').locator('img').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Confirm release' }).click();
  await page.getByRole('dialog').getByRole('checkbox').last().check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm release' }).click();
  await expect(page.getByText('Verified — marked Returned')).toBeVisible();

  // 7. Student sees Returned; management sees it read-only
  await asRole(page, 'student');
  await page.goto(`me/complaints/${cid}`);
  await expect(page.getByText('Returned').first()).toBeVisible();
  await asRole(page, 'management');
  await expect(page).toHaveURL(/\/management/);
  await page.goto('management/complaints');
  await expect(page.locator('tr', { hasText: cid })).toContainText('Returned');
  await expect(page.getByRole('button', { name: /Edit|Save|Delete|Approve/ })).toHaveCount(0);
  await page.goto('management/handovers');
  await page.locator('tr', { hasText: cid }).getByRole('button', { name: 'Evidence' }).click();
  await expect(page.getByTestId('evidence-handover').locator('li').first()).toBeVisible(); // proof photo, read-only
  await expect(page.getByTestId('evidence-gallery')).toHaveCount(0);

  // persistence across reload in the same session
  await page.reload();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  expect(apiHits).toEqual([]);
});

test('demo: admin edit → save → reload → audit history; student edits own; reset', async ({ page }) => {
  await asRole(page, 'admin');
  await page.goto('staff/complaints');
  await page.locator('tr', { hasText: 'Brown leather wallet' }).locator('a').first().click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  const m = page.getByTestId('edit-modal');
  await m.getByLabel('Item name').fill('Brown leather wallet (Woodland)');
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(m.getByText('Give a short reason')).toBeVisible();
  await m.getByLabel('Reason for this change').fill('Brand added after phone call');
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Brown leather wallet (Woodland)').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Brown leather wallet (Woodland)').first()).toBeVisible();
  await page.goto('staff/activity');
  await expect(page.getByText('complaint edited').first()).toBeVisible();

  await asRole(page, 'student');
  await page.locator('a', { hasText: 'Woodland' }).first().click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('edit-modal').getByLabel('Last seen location').fill('Central Library, reading hall');
  await page.getByTestId('edit-modal').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Central Library, reading hall').first()).toBeVisible();

  // management cannot reset; admin can
  await asRole(page, 'management');
  await expect(page.getByRole('button', { name: 'Reset demo' })).toHaveCount(0);
  await asRole(page, 'admin');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await asRole(page, 'student');
  await expect(page.getByText('Brown leather wallet', { exact: true })).toBeVisible();
});
