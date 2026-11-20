import { describe, expect, it } from 'vitest';
import { complaintBody, makeClient, STUDENT } from './helpers';

// Every Main Admin route (method, path). Management, students and guests must get 401/403 on all of them.
const ADMIN_ROUTES: [string, string][] = [
  ['GET', '/api/staff/dashboard'], ['GET', '/api/staff/complaints'], ['GET', '/api/staff/complaints/FB-AAAA-AAAA'],
  ['POST', '/api/staff/complaints/FB-AAAA-AAAA/status'], ['POST', '/api/staff/complaints/FB-AAAA-AAAA/note'],
  ['POST', '/api/staff/complaints/FB-AAAA-AAAA/propose-match'], ['POST', '/api/staff/complaints/FB-AAAA-AAAA/withdraw-match'],
  ['GET', '/api/staff/found-items'], ['POST', '/api/staff/found-items'], ['GET', '/api/staff/found-items/FI-AAAAAAAA'],
  ['POST', '/api/staff/found-items/FI-AAAAAAAA/status'], ['GET', '/api/staff/claims'], ['POST', '/api/staff/claims/CL-AAAAAAAA/decision'],
  ['GET', '/api/staff/handovers'], ['POST', '/api/staff/handovers'], ['GET', '/api/staff/handovers/HO-AAAAAAAA'],
  ['POST', '/api/staff/handovers/HO-AAAAAAAA/release'], ['POST', '/api/staff/handovers/HO-AAAAAAAA/cancel'],
  ['POST', '/api/staff/handovers/HO-AAAAAAAA/evidence'], ['POST', '/api/staff/handovers/HO-AAAAAAAA/delivery-code'], ['POST', '/api/staff/handovers/HO-AAAAAAAA/delivered'],
  ['POST', '/api/staff/found-items/FI-AAAAAAAA/evidence'], ['POST', '/api/staff/found-items/FI-AAAAAAAA/edit'], ['POST', '/api/staff/complaints'], ['POST', '/api/staff/evidence/EV-AAAAAAAA/archive'], ['POST', '/api/staff/claims/CL-AAAAAAAA/notes'], ['POST', '/api/staff/handovers/HO-AAAAAAAA/correct'], ['GET', '/api/staff/evidence?type=handover&id=HO-AAAAAAAA'], ['GET', '/api/staff/evidence/EV-AAAAAAAA/file'],
  ['GET', '/api/staff/unclaimed'], ['GET', '/api/staff/activity'], ['GET', '/api/staff/settings'], ['POST', '/api/staff/settings'],
  ['POST', '/api/staff/backup'], ['GET', '/api/staff/files/photos~00000000-0000-0000-0000-000000000000'], ['GET', '/api/staff/registry'],
  ['POST', '/api/staff/registry/import'], ['POST', '/api/staff/registry/22CSE104'], ['GET', '/api/staff/guests'],
  ['POST', '/api/staff/guests/abc/status'], ['GET', '/api/staff/roles'], ['POST', '/api/staff/roles'],
  ['GET', '/api/staff/schema'], ['POST', '/api/staff/schema/migrate'],
];

describe('Management portal is monitoring-only (Option A)', () => {
  it('management gets 403 on every Main Admin route, including all writes', async () => {
    const c = makeClient();
    const mgmt = await c.staff('dean@college.edu');
    for (const [m, p] of ADMIN_ROUTES) {
      const r = await c.call(m, p, m === 'POST' ? {} : undefined, mgmt);
      expect([p, r.status]).toEqual([p, 403]);
    }
    // there are no write routes under /api/mgmt at all
    for (const p of ['/api/mgmt/complaints', '/api/mgmt/analytics', '/api/mgmt/export', '/api/mgmt/evidence', '/api/mgmt/evidence/EV-AAAAAAAA/file']) expect((await c.call('POST', p, {}, mgmt)).status).toBe(404);
  });

  it('students and guests cannot reach admin or management APIs', async () => {
    const c = makeClient();
    const s = await c.reporter('student', STUDENT.phone);
    const g = await c.reporter('guest', '+919900000555');
    for (const tok of [s, g, undefined]) {
      for (const [m, p] of [...ADMIN_ROUTES.slice(0, 6), ['GET', '/api/mgmt/analytics'], ['GET', '/api/mgmt/audit']] as [string, string][]) {
        expect([401, 403]).toContain((await c.call(m, p, m === 'POST' ? {} : undefined, tok)).status);
      }
    }
  });

  it('management sees who reported, but contact details, evidence and private item data are redacted', async () => {
    const c = makeClient();
    const s = await c.reporter('student', STUDENT.phone);
    const sub = await c.call('POST', '/api/me/complaints', complaintBody(), s);
    const admin = await c.staff('boss@college.edu');
    await c.call('POST', '/api/staff/found-items', { category: 'ID Card / Documents', itemName: 'ID card', publicDescription: 'College ID card 22CSE10456 found', privateDetails: 'Photo of Asha', colorFeatures: 'Blue lanyard', foundLocation: 'Canteen', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Drawer 1' }, admin);
    const mgmt = await c.staff('dean@college.edu');
    const list = await c.call('GET', '/api/mgmt/complaints', undefined, mgmt);
    expect(list.json.rows[0]).toMatchObject({ complaint_id: sub.json.complaintId, name: STUDENT.name, student_id: STUDENT.sid, reporter_type: 'Student' });
    const text = JSON.stringify(list.json) + JSON.stringify((await c.call('GET', `/api/mgmt/complaints/${sub.json.complaintId}`, undefined, mgmt)).json);
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('green notebook');
    const found = JSON.stringify((await c.call('GET', '/api/mgmt/found-items', undefined, mgmt)).json);
    expect(found).not.toContain('Photo of Asha');
    expect(found).not.toContain('Drawer 1');
    expect(found).not.toContain('22CSE10456'); // ID numbers masked
    const a = await c.call('GET', '/api/mgmt/analytics', undefined, mgmt);
    expect(a.json.totals).toMatchObject({ complaints: 1, foundItems: 1, pending: 1 });
    expect(a.json.reporterTypes).toEqual({ Student: 1 });
    const csv = await c.call('GET', '/api/mgmt/export?type=complaints', undefined, mgmt);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text).toContain(sub.json.complaintId);
    expect(csv.text).not.toContain('9876543210');
    expect((c.store as any).tables.Activity_Log.some((r: any) => r.action === 'report_exported' && r.actor === 'dean@college.edu')).toBe(true);
  });

  it('audit log is append-only at the storage layer', async () => {
    const c = makeClient();
    await c.staff('boss@college.edu');
    const id = (c.store as any).tables.Activity_Log[0].log_id;
    const [r] = await c.store!.exec([{ op: 'update', table: 'Activity_Log', value: id, patch: { details: 'tampered' } }]);
    expect(r.ok).toBe(false);
  });

  it('rejects disallowed origins and unknown routes', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/api/public/config', undefined, undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.call('GET', '/api/nope')).status).toBe(404);
    const cfg = await c.call('GET', '/api/public/config');
    expect(cfg.json.auth).toMatchObject({ enabled: true, devAuth: true });
  });
});
