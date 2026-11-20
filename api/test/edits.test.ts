import { describe, expect, it } from 'vitest';
import { complaintBody, makeClient, STUDENT, STUDENT2, TINY_PNG } from './helpers';

const edit = { category: 'Electronics', itemName: 'Scientific calculator', description: 'Casio fx-991EX calculator with a blue cover', colorFeatures: 'Black, blue cover', lastSeenLocation: 'Block C, room 204', lostDate: new Date().toISOString().slice(0, 10), lostTime: '10:30' };
const item = { category: 'Electronics', itemName: 'Calculator', publicDescription: 'Calculator found in Block C', privateDetails: 'Name sticker inside cover', colorFeatures: 'Black', foundLocation: 'Block C', foundDate: new Date().toISOString().slice(0, 10), foundTime: '', storageLocation: 'Shelf A1' };

describe('Manual edits', () => {
  it('reporter edits own complaint only before verification; identity and status untouched; audited', async () => {
    const c = makeClient();
    const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
    const other = await c.reporter('student', STUDENT2.phone, 'other-uid');
    const cid = (await c.call('POST', '/api/me/complaints', complaintBody(), stu)).json.complaintId;
    const r = await c.call('POST', `/api/me/complaints/${cid}/edit`, { ...edit, ownershipEvidence: 'Name label under the battery cover', name: 'Hacker', status: 'Returned', reporter_uid: 'x' }, stu);
    expect(r.status).toBe(200);
    const row = (c.store as any).tables.Complaints.find((x: any) => x.complaint_id === cid);
    expect(row).toMatchObject({ item_name: 'Scientific calculator', name: STUDENT.name, reporter_uid: 'stu-uid', status: 'Submitted' });
    expect((await c.call('POST', `/api/me/complaints/${cid}/edit`, { ...edit, ownershipEvidence: 'Name label under the battery cover' }, other)).status).toBe(404);
    const log = (c.store as any).tables.Activity_Log.find((x: any) => x.action === 'complaint_edited_by_reporter');
    expect(log.details).toContain('item_name: "Black backpack" → "Scientific calculator"');
    expect(log.details).not.toContain('battery'); // private evidence not copied into the log
    // locked after verification starts
    const admin = await c.staff('boss@college.edu');
    const fi = (await c.call('POST', '/api/staff/found-items', item, admin)).json.itemId;
    await c.call('POST', `/api/staff/complaints/${cid}/propose-match`, { itemId: fi }, admin);
    expect((await c.call('POST', `/api/me/complaints/${cid}/edit`, { ...edit, itemName: 'Other', ownershipEvidence: 'Name label under the battery cover' }, stu)).json.error).toBe('locked');
  });

  it('admin creates, edits complaints and found items with reasons; management cannot', async () => {
    const c = makeClient();
    const admin = await c.staff('boss@college.edu');
    const mgmt = await c.staff('dean@college.edu');
    const created = await c.call('POST', '/api/staff/complaints', { ...edit, reporterName: 'Walk-in Visitor', reporterContact: 'front desk', studentId: '', ownershipEvidence: 'Initials RK scratched on back', reason: 'Reported at counter' }, admin);
    expect(created.status).toBe(201);
    const cid = created.json.complaintId;
    expect((await c.call('POST', `/api/staff/complaints/${cid}/edit`, { ...edit, itemName: 'Casio calculator' })).status).toBe(401);
    expect((await c.call('POST', `/api/staff/complaints/${cid}/edit`, { ...edit, itemName: 'Casio calculator' }, admin)).status).toBe(422); // reason required
    expect((await c.call('POST', `/api/staff/complaints/${cid}/edit`, { ...edit, itemName: 'Casio calculator', reason: 'Typo' }, admin)).status).toBe(200);
    expect((await c.call('POST', `/api/staff/complaints/${cid}/edit`, { ...edit, itemName: 'X calc', reason: 'Typo' }, mgmt)).status).toBe(403);
    const fi = (await c.call('POST', '/api/staff/found-items', item, admin)).json.itemId;
    expect((await c.call('POST', `/api/staff/found-items/${fi}/edit`, { ...item, storageLocation: 'Shelf B2', reason: 'Moved' }, admin)).status).toBe(200);
    expect((c.store as any).tables.Found_Items[0].storage_location).toBe('Shelf B2');
    const actions = (c.store as any).tables.Activity_Log.map((x: any) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['complaint_created_by_staff', 'complaint_edited', 'found_item_edited']));
    // photos: replace = upload new + archive old; file kept, archived hidden from management
    const up = await c.call('POST', `/api/staff/found-items/${fi}/evidence`, { kind: 'item_photo', mime: 'image/png', dataBase64: TINY_PNG }, admin);
    expect((await c.call('POST', `/api/staff/evidence/${up.json.evidenceId}/archive`, { reason: 'Blurry, replaced' }, mgmt)).status).toBe(403);
    expect((await c.call('POST', `/api/staff/evidence/${up.json.evidenceId}/archive`, { reason: 'Blurry, replaced' }, admin)).status).toBe(200);
    const list = (await c.call('GET', `/api/staff/evidence?type=found_item&id=${fi}`, undefined, admin)).json.rows;
    expect(list[0]).toMatchObject({ archived: true, archivedReason: 'Blurry, replaced' });
    expect((await c.call('GET', `/api/mgmt/evidence?type=found_item&id=${fi}`, undefined, mgmt)).json.rows).toHaveLength(0);
    expect((c.store as any).files.size).toBeGreaterThan(0);
  });

  it('handover corrections cannot rewrite a confirmed receiver or completed evidence', async () => {
    const c = makeClient();
    const stu = await c.reporter('student', STUDENT.phone, 'stu-uid');
    const admin = await c.staff('boss@college.edu');
    const cid = (await c.call('POST', '/api/me/complaints', complaintBody(), stu)).json.complaintId;
    const fi = (await c.call('POST', '/api/staff/found-items', item, admin)).json.itemId;
    await c.call('POST', `/api/staff/complaints/${cid}/propose-match`, { itemId: fi }, admin);
    const cl = (await c.call('POST', `/api/me/complaints/${cid}/claim`, { itemId: fi, evidence: 'Green notebook with my roll number inside' }, stu)).json.claimId;
    await c.call('POST', `/api/staff/claims/${cl}/decision`, { decision: 'approve', notes: 'ok fine', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, admin);
    expect((await c.call('POST', `/api/staff/claims/${cl}/notes`, { note: 'Also checked serial' }, admin)).status).toBe(200);
    expect((c.store as any).tables.Claim_Requests[0].decision_notes).toMatch(/^ok fine\n\[Correction .*\] Also checked serial$/);
    const start = await c.call('POST', '/api/staff/handovers', { claimId: cl, receiverType: 'owner', receiverName: 'Asha Redy', receiverIdType: 'College ID card', receiverIdLast4: '0104' }, admin);
    const ho = start.json.handoverId;
    expect((await c.call('POST', `/api/staff/handovers/${ho}/correct`, { receiverName: 'Asha Reddy', reason: 'Spelling' }, admin)).status).toBe(200);
    await c.call('POST', `/api/me/handovers/${ho}/acknowledge`, { code: start.json.code, signatureName: 'Asha Reddy', accept: true }, stu);
    expect((await c.call('POST', `/api/staff/handovers/${ho}/correct`, { receiverName: 'Someone Else', reason: 'Change' }, admin)).json.error).toBe('locked');
    expect((await c.call('POST', `/api/staff/handovers/${ho}/correct`, { note: 'ID re-checked', reason: 'Record' }, admin)).status).toBe(200);
    const up = await c.call('POST', `/api/staff/handovers/${ho}/evidence`, { kind: 'handover_photo', mime: 'image/png', dataBase64: TINY_PNG }, admin);
    await c.call('POST', `/api/staff/handovers/${ho}/release`, { confirmPhysicalRelease: true }, admin);
    expect((await c.call('POST', `/api/staff/evidence/${up.json.evidenceId}/archive`, { reason: 'try' }, admin)).json.error).toBe('evidence_locked');
    expect((await c.call('POST', `/api/staff/complaints/${cid}/edit`, { ...edit, reason: 'late' }, admin)).json.error).toBe('locked');
  });
});
