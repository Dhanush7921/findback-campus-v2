import { describe, expect, it } from 'vitest';
import { complaintBody, makeClient, STUDENT, TINY_JPEG, TINY_PNG } from './helpers';

const PDF = btoa('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const item = { category: 'Bag / Backpack', itemName: 'Black backpack', publicDescription: 'Black backpack found near reading hall', privateDetails: 'Green notebook inside', colorFeatures: 'Black', foundLocation: 'Central library', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Shelf A2' };

async function approved(opts: { delivery?: boolean } = {}) {
  const c = makeClient();
  const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
  const admin = await c.staff('boss@college.edu');
  const clerk = await c.staff('clerk@college.edu');
  const mgmt = await c.staff('dean@college.edu');
  if (opts.delivery) await c.call('POST', '/api/staff/settings', { settings: { home_delivery_enabled: 'true' } }, admin);
  const cid = (await c.call('POST', '/api/me/complaints', complaintBody(), stu)).json.complaintId as string;
  const fi = await c.call('POST', '/api/staff/found-items', { ...item, photos: [{ mime: 'image/jpeg', dataBase64: TINY_JPEG }] }, admin);
  const itemId = fi.json.itemId as string;
  await c.call('POST', `/api/staff/complaints/${cid}/propose-match`, { itemId }, admin);
  const claimId = (await c.call('POST', `/api/me/complaints/${cid}/claim`, { itemId, evidence: 'Green notebook with my roll number inside the front pocket' }, stu)).json.claimId as string;
  await c.call('POST', `/api/staff/claims/${claimId}/decision`, { decision: 'approve', notes: 'Evidence matches', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, admin);
  return { c, stu, admin, clerk, mgmt, cid, itemId, claimId };
}
const ho = { receiverType: 'owner', receiverName: STUDENT.name, receiverIdType: 'College ID card', receiverIdLast4: '0104' };

describe('Found item evidence', () => {
  it('stores multiple photos privately with staff identity, hash and audit; rejects bad types and sizes', async () => {
    const { c, admin, mgmt, itemId } = await approved();
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'image/png', dataBase64: TINY_PNG, caption: 'Back side' }, admin)).status).toBe(201);
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'application/pdf', dataBase64: PDF }, admin)).status).toBe(201);
    // spoofed type: PNG bytes declared as JPEG, script declared as PDF
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'image/jpeg', dataBase64: TINY_PNG }, admin)).status).toBe(415);
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'application/pdf', dataBase64: btoa('<script>alert(1)</script>') }, admin)).status).toBe(415);
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'image/gif', dataBase64: TINY_PNG }, admin)).status).toBe(422);
    const big = btoa('\xff\xd8\xff' + 'a'.repeat(5 * 1024 * 1024));
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'image/jpeg', dataBase64: big }, admin)).status).toBe(413);
    const list = await c.call('GET', `/api/staff/evidence?type=found_item&id=${itemId}`, undefined, admin);
    expect(list.json.rows).toHaveLength(3);
    expect(list.json.rows[0]).toMatchObject({ kind: 'item_photo', uploadedBy: 'boss@college.edu', uploadedRole: 'admin' });
    expect(list.json.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const log = (c.store as any).tables.Activity_Log.filter((r: any) => r.action === 'evidence_uploaded' && r.entity_id === itemId);
    expect(log).toHaveLength(3);
    // management: view allowed (logged), upload refused
    const file = await c.call('GET', `/api/mgmt/evidence/${list.json.rows[1].evidenceId}/file`, undefined, mgmt);
    expect(file.status).toBe(200);
    expect(file.headers.get('cache-control')).toContain('no-store');
    expect((c.store as any).tables.Activity_Log.some((r: any) => r.action === 'evidence_viewed')).toBe(true);
    expect((await c.call('POST', `/api/staff/found-items/${itemId}/evidence`, { kind: 'item_photo', mime: 'image/png', dataBase64: TINY_PNG }, mgmt)).status).toBe(403);
    // no student/guest or anonymous access
    const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
    expect((await c.call('GET', `/api/staff/evidence?type=found_item&id=${itemId}`, undefined, stu)).status).toBe(401);
    expect((await c.call('GET', `/api/mgmt/evidence/${list.json.rows[0].evidenceId}/file`)).status).toBe(401);
  });

  it('cannot be replaced or deleted', async () => {
    const { c, admin, itemId } = await approved();
    const ev = (await c.call('GET', `/api/staff/evidence?type=found_item&id=${itemId}`, undefined, admin)).json.rows[0].evidenceId;
    for (const m of ['DELETE', 'PUT', 'PATCH']) expect([404, 405]).toContain((await c.call(m, `/api/staff/evidence/${ev}/file`, {}, admin)).status);
    const r = await (c.store as any).exec([{ op: 'update', table: 'Evidence_Files', value: ev, patch: { file_id: 'photos/x' } }]);
    expect(r[0]).toMatchObject({ ok: false, error: 'append_only' });
  });
});

describe('Proof of handover (counter)', () => {
  it('requires receiver confirmation + admin verification; policy can require photo/document proof; evidence freezes after release', async () => {
    const { c, stu, admin, mgmt, cid } = await approved();
    await c.call('POST', '/api/staff/settings', { settings: { handover_proof_required: 'true' } }, admin);
    const claimId = (c.store as any).tables.Claim_Requests[0].claim_id;
    const start = await c.call('POST', '/api/staff/handovers', { claimId, ...ho }, admin);
    const { handoverId, code } = start.json;
    const ack = await c.call('POST', `/api/me/handovers/${handoverId}/acknowledge`, { code, signatureName: STUDENT.name, accept: true, signature: { mime: 'image/png', dataBase64: TINY_PNG } }, stu);
    expect(ack.status).toBe(200);
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).json.complaint.status).toBe('Awaiting Receiver Confirmation');
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('proof_required');
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/evidence`, { kind: 'handover_document', mime: 'application/pdf', dataBase64: PDF, caption: 'Signed register page' }, admin)).status).toBe(201);
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/release`, { confirmPhysicalRelease: true }, admin)).status).toBe(200);
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).json.complaint.status).toBe('Returned');
    expect((await c.call('POST', `/api/staff/handovers/${handoverId}/evidence`, { kind: 'handover_photo', mime: 'image/png', dataBase64: TINY_PNG }, admin)).json.error).toBe('evidence_locked');
    const h = await c.call('GET', `/api/staff/handovers/${handoverId}`, undefined, admin);
    expect(h.json.handover).toMatchObject({ complaintId: cid, receiverName: STUDENT.name, approvedBy: 'boss@college.edu', releasedBy: 'boss@college.edu', status: 'Released' });
    // management sees redacted list: signature withheld
    const ml = await c.call('GET', `/api/mgmt/evidence?type=handover&id=${handoverId}`, undefined, mgmt);
    const sig = ml.json.rows.find((r: any) => r.kind === 'signature');
    expect(sig).toMatchObject({ withheld: true, uploadedBy: 'Receiver (verified phone)' });
    expect((await c.call('GET', `/api/mgmt/evidence/${sig.evidenceId}/file`, undefined, mgmt)).status).toBe(403);
    expect((await c.call('GET', `/api/staff/evidence/${sig.evidenceId}/file`, undefined, admin)).status).toBe(200);
  });
});

describe('Home delivery', () => {
  it('is off by default', async () => {
    const { c, admin, claimId } = await approved();
    const r = await c.call('POST', '/api/staff/handovers', { claimId, ...ho, mode: 'delivery', deliveryStaff: 'clerk@college.edu', deliveryAddress: 'Room 12, Boys Hostel B, Campus Road' }, admin);
    expect(r.json.error).toBe('delivery_disabled');
  });

  it('assigned staff issues doorstep code, recipient acknowledges, proof + completion time recorded, another staff finalises; address never exposed', async () => {
    const { c, stu, admin, clerk, mgmt, cid, claimId } = await approved({ delivery: true });
    await c.call('POST', '/api/staff/settings', { settings: { require_two_staff: 'true' } }, admin);
    expect((await c.call('POST', '/api/staff/handovers', { claimId, ...ho, mode: 'delivery', deliveryStaff: 'dean@college.edu', deliveryAddress: 'Room 12, Boys Hostel B, Campus Road' }, admin)).status).toBe(422); // management is not delivery staff
    const start = await c.call('POST', '/api/staff/handovers', { claimId, ...ho, mode: 'delivery', deliveryStaff: 'clerk@college.edu', deliveryAddress: 'Room 12, Boys Hostel B, Campus Road' }, admin);
    expect(start.status).toBe(201);
    expect(start.json.code).toBeNull();
    const id = start.json.handoverId;
    expect((await c.call('POST', `/api/staff/handovers/${id}/delivery-code`, {}, admin)).status).toBe(403); // not the assigned courier
    const dc = await c.call('POST', `/api/staff/handovers/${id}/delivery-code`, {}, clerk);
    expect(dc.json.code).toMatch(/^\d{6}$/);
    expect((await c.call('POST', `/api/staff/handovers/${id}/delivered`, { confirmDelivered: true }, clerk)).json.error).toBe('not_acknowledged');
    expect((await c.call('POST', `/api/me/handovers/${id}/acknowledge`, { code: dc.json.code, signatureName: STUDENT.name, accept: true }, stu)).status).toBe(200);
    expect((await c.call('POST', `/api/staff/handovers/${id}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('not_delivered');
    expect((await c.call('POST', `/api/staff/handovers/${id}/delivered`, { confirmDelivered: true }, clerk)).json.error).toBe('proof_required');
    expect((await c.call('POST', `/api/staff/handovers/${id}/evidence`, { kind: 'delivery_proof', mime: 'image/jpeg', dataBase64: TINY_JPEG }, admin)).status).toBe(403);
    expect((await c.call('POST', `/api/staff/handovers/${id}/evidence`, { kind: 'delivery_proof', mime: 'image/jpeg', dataBase64: TINY_JPEG, caption: 'At hostel B gate' }, clerk)).status).toBe(201);
    const del = await c.call('POST', `/api/staff/handovers/${id}/delivered`, { confirmDelivered: true }, clerk);
    expect(del.status).toBe(200);
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).json.complaint.status).toBe('Awaiting Receiver Confirmation');
    expect((await c.call('POST', `/api/staff/handovers/${id}/release`, { confirmPhysicalRelease: true }, clerk)).json.error).toBe('two_staff_required');
    expect((await c.call('POST', `/api/staff/handovers/${id}/release`, { confirmPhysicalRelease: true }, admin)).json.error).toBe('two_staff_required'); // boss approved the claim
    expect((await c.call('POST', '/api/staff/roles', { email: 'warden@college.edu', role: 'admin', name: 'Warden' }, admin)).status).toBeLessThan(300);
    const warden = await c.staff('warden@college.edu');
    expect((await c.call('POST', `/api/staff/handovers/${id}/release`, { confirmPhysicalRelease: true }, warden)).status).toBe(200);
    const h = (await c.call('GET', `/api/staff/handovers/${id}`, undefined, admin)).json.handover;
    expect(h).toMatchObject({ mode: 'delivery', deliveryStaff: 'clerk@college.edu', deliveredBy: 'clerk@college.edu', releasedBy: 'warden@college.edu', status: 'Released', deliveryAddress: 'Room 12, Boys Hostel B, Campus Road' });
    expect(h.deliveredAt).toBe(del.json.deliveredAt);
    // address never in management or reporter responses
    const mg = await c.call('GET', '/api/mgmt/handovers', undefined, mgmt);
    expect(mg.text).not.toContain('Hostel B');
    expect(mg.json.rows[0]).toMatchObject({ mode: 'delivery' });
    expect((await c.call('GET', `/api/me/complaints/${cid}`, undefined, stu)).text).not.toContain('Hostel B');
    expect((await c.call('GET', `/api/mgmt/export?type=handovers`, undefined, mgmt)).text).not.toContain('Hostel B');
    expect((await c.call('GET', `/api/mgmt/audit`, undefined, mgmt)).text).not.toContain('Hostel B');
  });
});
