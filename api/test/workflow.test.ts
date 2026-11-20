import { describe, expect, it } from 'vitest';
import { complaintBody, makeClient, PROXY_PHONE, STUDENT, STUDENT2, TINY_PNG } from './helpers';

const item = { category: 'Bag / Backpack', itemName: 'Black backpack', publicDescription: 'Black backpack found near reading hall', privateDetails: 'Green notebook inside, roll 22CSE104', colorFeatures: 'Black, red zip pulls', foundLocation: 'Central library', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Shelf A2' };

async function readyForCollection() {
  const c = makeClient();
  const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
  const admin = await c.staff('boss@college.edu');
  const sub = await c.call('POST', '/api/me/complaints', complaintBody({ name: 'Spoofed Name', studentId: 'FAKE1', submitted_by: 'someone-else' }), stu);
  expect(sub.status).toBe(201);
  const cid = sub.json.complaintId as string;
  const fi = await c.call('POST', '/api/staff/found-items', item, admin);
  expect(fi.status).toBe(201);
  const itemId = fi.json.itemId as string;
  expect((await c.call('POST', `/api/staff/complaints/${cid}/propose-match`, { itemId }, admin)).status).toBe(200);
  const view = await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu);
  expect(view.json.matches[0].item.description).not.toContain('Green notebook'); // private details never shown
  const claim = await c.call('POST', `/api/me/complaints/${cid}/claim`, { itemId, evidence: 'Green notebook with my roll number inside the front pocket' }, stu);
  expect(claim.status).toBe(201);
  const claimId = claim.json.claimId as string;
  const appr = await c.call('POST', `/api/staff/claims/${claimId}/decision`, { decision: 'approve', notes: 'Evidence matches private details', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, admin);
  expect(appr.status).toBe(200);
  return { c, stu, admin, cid, itemId, claimId };
}

describe('Complaint attribution', () => {
  it('records the verified submitter from the session and registry, ignoring client identity fields', async () => {
    const { c, cid } = await readyForCollection();
    const row = (c.store as any).tables.Complaints.find((r: any) => r.complaint_id === cid);
    expect(row).toMatchObject({ reporter_uid: 'stu-uid', reporter_type: 'Student', verified_phone: STUDENT.phone, name: STUDENT.name, student_id: STUDENT.sid, department: STUDENT.dept });
    const admin = await c.staff('boss@college.edu');
    const d = await c.call('GET', `/api/staff/complaints/${cid}`, undefined, admin);
    expect(d.json.reporter).toMatchObject({ type: 'Student', studentId: STUDENT.sid, verifiedPhone: STUDENT.phone });
  });
});

describe('Receiver-confirmed handover', () => {
  it('requires desk code on the verified phone + staff release; rejects replay, wrong codes, and premature release', async () => {
    const { c, stu, admin, cid, itemId, claimId } = await readyForCollection();
    // Returned cannot be set manually
    expect((await c.call('POST', `/api/staff/complaints/${cid}/status`, { status: 'Returned' }, admin)).json.error).toBe('use_workflow');
    const start = await c.call('POST', '/api/staff/handovers', { claimId, receiverType: 'owner', receiverName: STUDENT.name, receiverIdType: 'College ID card', receiverIdLast4: '0104' }, admin);
    expect(start.status).toBe(201);
    const { handoverId, code } = start.json;
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify((c.store as any).tables.Handover_Records)).not.toContain(`"${code}"`); // only a keyed hash is stored
    // second start while code is live is refused
    expect((await c.call('POST', '/api/staff/handovers', { claimId, receiverType: 'owner', receiverName: 'x y', receiverIdType: 'College ID card', receiverIdLast4: '0104' }, admin)).status).toBe(409);
    // release before acknowledgment refused
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('not_acknowledged');
    // another student cannot see or acknowledge it
    const other = await c.reporter('student', STUDENT2.phone, 'other-uid');
    expect((await c.call('GET', '/api/me/handovers', undefined, other)).json.rows).toHaveLength(0);
    expect((await c.call('POST', `/api/me/handovers/${handoverId}/acknowledge`, { code, signatureName: 'Ravi', accept: true }, other)).status).toBe(404);
    // the owner sees it pending
    expect((await c.call('GET', '/api/me/handovers', undefined, stu)).json.rows[0].handoverId).toBe(handoverId);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await c.call('POST', `/api/me/handovers/${handoverId}/acknowledge`, { code: wrong, signatureName: STUDENT.name, accept: true }, stu)).status).toBe(401);
    const ack = await c.call('POST', `/api/me/handovers/${handoverId}/acknowledge`, { code, signatureName: STUDENT.name, accept: true, signature: { mime: 'image/png', dataBase64: TINY_PNG } }, stu);
    expect(ack.status).toBe(200);
    // replay of the same code is refused
    expect((await c.call('POST', `/api/me/handovers/${handoverId}/acknowledge`, { code, signatureName: STUDENT.name, accept: true }, stu)).json.error).toBe('already_used');
    // still not Returned until staff confirms release
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).json.complaint.status).toBe('Awaiting Receiver Confirmation');
    const rel = await c.call('POST', `/api/staff/handovers/${handoverId}/release`, { confirmPhysicalRelease: true }, admin);
    expect(rel.status).toBe(200);
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('already_released');
    const view = await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu);
    expect(view.json.complaint.status).toBe('Returned');
    expect(view.json.receipt).toMatchObject({ handoverId, status: 'Released', receiverName: STUDENT.name });
    const h = (c.store as any).tables.Handover_Records.find((r: any) => r.handover_id === handoverId);
    expect(h).toMatchObject({ complaint_id: cid, item_id: itemId, receiver_uid: 'stu-uid', reporter_uid: 'stu-uid', approved_by: 'boss@college.edu', handed_over_by: 'boss@college.edu', started_by: 'boss@college.edu', status: 'Released', challenge_hash: '' });
    expect(h.verification_method).toContain('OTP');
    expect(h.evidence_file_id).not.toBe('');
    expect((c.store as any).tables.Found_Items[0].status).toBe('Returned');
    // management can inspect the read-only audit entry
    const mgmt = await c.staff('dean@college.edu');
    const audit = await c.call('GET', '/api/mgmt/audit', undefined, mgmt);
    expect(audit.json.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['item_released', 'receipt_acknowledged', 'claim_approved']));
  });

  it('locks the code after 5 wrong attempts and returns the complaint to Ready for Collection', async () => {
    const { c, stu, admin, cid, claimId } = await readyForCollection();
    const start = await c.call('POST', '/api/staff/handovers', { claimId, receiverType: 'owner', receiverName: STUDENT.name, receiverIdType: 'Aadhaar', receiverIdLast4: '1234' }, admin);
    const wrong = start.json.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await c.call('POST', `/api/me/handovers/${start.json.handoverId}/acknowledge`, { code: wrong, signatureName: 'Asha', accept: true }, stu);
    expect((await c.call('POST', `/api/me/handovers/${start.json.handoverId}/acknowledge`, { code: start.json.code, signatureName: 'Asha', accept: true }, stu)).json.error).toBe('already_used');
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).json.complaint.status).toBe('Ready for Collection');
  });

  it('proxy collection needs owner authorisation and the proxy’s own verified phone; both identities are recorded', async () => {
    const { c, stu, admin, cid, claimId } = await readyForCollection();
    const body = { claimId, receiverType: 'proxy', receiverName: 'Kiran Rao', receiverIdType: 'Aadhaar', receiverIdLast4: '9876' };
    expect((await c.call('POST', '/api/staff/handovers', body, admin)).json.error).toBe('no_proxy_authorization');
    expect((await c.call('POST', `/api/me/complaints/${cid}/proxy`, { proxyName: 'Kiran Rao', proxyPhone: '99000 00099', consent: true }, stu)).status).toBe(200);
    const start = await c.call('POST', '/api/staff/handovers', body, admin);
    expect(start.status).toBe(201);
    // the owner cannot acknowledge on the proxy's behalf
    expect((await c.call('POST', `/api/me/handovers/${start.json.handoverId}/acknowledge`, { code: start.json.code, signatureName: 'Asha', accept: true }, stu)).status).toBe(404);
    const proxy = await c.reporter('guest', PROXY_PHONE, 'proxy-uid');
    const ack = await c.call('POST', `/api/me/handovers/${start.json.handoverId}/acknowledge`, { code: start.json.code, signatureName: 'Kiran Rao', accept: true }, proxy);
    expect(ack.status).toBe(200);
    expect((await c.call('POST', `/api/staff/handovers/${start.json.handoverId}/release`, { confirmPhysicalRelease: true }, admin)).status).toBe(200);
    const h = (c.store as any).tables.Handover_Records.find((r: any) => r.handover_id === start.json.handoverId);
    expect(h).toMatchObject({ receiver_type: 'proxy', receiver_uid: 'proxy-uid', reporter_uid: 'stu-uid', receiver_phone: PROXY_PHONE });
    expect(JSON.parse(h.owner_authorization)).toMatchObject({ proxyName: 'Kiran Rao', authorizedBy: 'stu-uid' });
  });

  it('two-staff rule: releaser must differ from claim approver when enabled', async () => {
    const { c, stu, admin, claimId } = await readyForCollection();
    await c.call('POST', '/api/staff/settings', { settings: { require_two_staff: 'true' } }, admin);
    const start = await c.call('POST', '/api/staff/handovers', { claimId, receiverType: 'owner', receiverName: STUDENT.name, receiverIdType: 'College ID card', receiverIdLast4: '0104' }, admin);
    await c.call('POST', `/api/me/handovers/${start.json.handoverId}/acknowledge`, { code: start.json.code, signatureName: 'Asha', accept: true }, stu);
    expect((await c.call('POST', `/api/staff/handovers/${start.json.handoverId}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('two_staff_required');
    const clerk = await c.staff('clerk@college.edu');
    expect((await c.call('POST', `/api/staff/handovers/${start.json.handoverId}/release`, { confirmPhysicalRelease: true }, clerk)).status).toBe(200);
  });
});

describe('Submissions', () => {
  it('idempotent replay, duplicate warning with explicit override, and per-reporter isolation', async () => {
    const c = makeClient();
    const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
    const body = complaintBody();
    const a = await c.call('POST', '/api/me/complaints', body, stu);
    const b = await c.call('POST', '/api/me/complaints', body, stu);
    expect(a.status).toBe(201);
    expect(b.json).toMatchObject({ complaintId: a.json.complaintId, replayed: true });
    const dup = await c.call('POST', '/api/me/complaints', complaintBody({ itemName: 'black  Backpack!' }), stu);
    expect(dup.status).toBe(409);
    expect(dup.json.details.complaintId).toBe(a.json.complaintId);
    const forced = await c.call('POST', '/api/me/complaints', complaintBody({ itemName: 'Black backpack', confirmNotDuplicate: true }), stu);
    expect(forced.status).toBe(201);
    expect((c.store as any).tables.Complaints).toHaveLength(2); // nothing silently deleted
    const other = await c.reporter('student', STUDENT2.phone, 'other-uid');
    expect((await c.call('GET', `/api/me/complaints/${a.json.complaintId}`, undefined, other)).status).toBe(404);
    expect((await c.call('GET', '/api/me/complaints', undefined, other)).json.rows).toHaveLength(0);
  });

  it('guests must give a name; are labelled Guest; cannot use student identity', async () => {
    const c = makeClient();
    const g = await c.reporter('guest', '+919900000123', 'g-uid');
    expect((await c.call('POST', '/api/me/complaints', complaintBody(), g)).json.details).toHaveProperty('guestName');
    const ok = await c.call('POST', '/api/me/complaints', complaintBody({ guestName: 'Visitor Parent', visitInfo: 'Open day, Block C', studentId: '22CSE104' }), g);
    expect(ok.status).toBe(201);
    const row = (c.store as any).tables.Complaints[0];
    expect(row).toMatchObject({ reporter_type: 'Guest', name: 'Visitor Parent', student_id: '', visit_info: 'Open day, Block C' });
    expect((await c.call('GET', '/api/staff/dashboard', undefined, g)).status).toBe(401);
  });

  it('honeypot, timing and bad images are rejected', async () => {
    const c = makeClient();
    const s = await c.reporter('student', STUDENT.phone);
    expect((await c.call('POST', '/api/me/complaints', complaintBody({ website: 'x' }), s)).status).toBe(400);
    expect((await c.call('POST', '/api/me/complaints', complaintBody({ elapsedMs: 100 }), s)).status).toBe(400);
    expect((await c.call('POST', '/api/me/complaints', complaintBody({ photo: { mime: 'image/png', dataBase64: btoa('not an image') } }), s)).status).toBe(415);
  });
});
