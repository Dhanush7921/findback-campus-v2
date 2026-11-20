import { describe, expect, it } from 'vitest';
import { resetJwksCache } from '../src/firebaseAuth';
import { makeClient, STUDENT, GUEST_PHONE } from './helpers';

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  return { kp, jwk: { ...jwk, kid: 'k1' } };
}
const b64u = (s: string | Uint8Array) => Buffer.from(s).toString('base64url');
async function sign(kp: CryptoKeyPair, payload: object, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(sig)}`;
}

describe('Firebase ID token verification (production path)', () => {
  it('verifies signature, issuer, audience, expiry and provider; registry decides student access', async () => {
    resetJwksCache();
    const { kp, jwk } = await keypair();
    const fetchImpl = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=60' } })) as unknown as typeof fetch;
    const c = makeClient({ env: { APP_ENV: 'production', DEV_AUTH: undefined, FIREBASE_PROJECT_ID: 'fb-proj' }, fetchImpl });
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: 'https://securetoken.google.com/fb-proj', aud: 'fb-proj', iat: now, exp: now + 600, auth_time: now, sub: 'uid-1', phone_number: STUDENT.phone, firebase: { sign_in_provider: 'phone' } };
    const post = async (payload: object, portal = 'student', key = kp, kid = 'k1') => c.call('POST', '/api/auth/session', { portal, idToken: await sign(key, payload, kid) });

    const ok = await post(base);
    expect(ok.status).toBe(200);
    expect(ok.json.profile).toMatchObject({ type: 'Student', studentId: STUDENT.sid, name: STUDENT.name });
    expect((await c.call('GET', '/api/me', undefined, ok.json.token)).status).toBe(200);

    expect((await post({ ...base, aud: 'other' })).status).toBe(401);
    expect((await post({ ...base, iss: 'https://securetoken.google.com/other' })).status).toBe(401);
    expect((await post({ ...base, exp: now - 600 })).status).toBe(401);
    expect((await post({ ...base, auth_time: now - 30 * 86400 })).status).toBe(401); // stale sign-in must be repeated
    expect((await post(base, 'student', kp, 'unknown'))).toMatchObject({ status: 401 });
    const { kp: other } = await keypair();
    expect((await post(base, 'student', other)).status).toBe(401);
    // Phone not in registry -> 403 as student, allowed as guest
    expect((await post({ ...base, sub: 'uid-2', phone_number: GUEST_PHONE })).json.error).toBe('not_in_registry');
    expect((await post({ ...base, sub: 'uid-2', phone_number: GUEST_PHONE }, 'guest')).status).toBe(200);
    // Google token cannot open the student portal; phone token cannot open staff
    expect((await post({ ...base, sub: 'g1', phone_number: undefined, email: 'boss@college.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } })).status).toBe(403);
    const staffWithPhone = await c.call('POST', '/api/staff/session', { idToken: await sign(kp, base) });
    expect(staffWithPhone.status).toBe(403);
    expect((await c.call('POST', '/api/auth/session', { portal: 'student', idToken: 'garbage' })).status).toBe(401);
  });

  it('rejects development tokens in production mode', async () => {
    const c = makeClient({ env: { APP_ENV: 'production', DEV_AUTH: '1', FIREBASE_PROJECT_ID: 'fb-proj' }, fetchImpl: (async () => new Response('{"keys":[]}')) as unknown as typeof fetch });
    const r = await c.call('POST', '/api/auth/session', { portal: 'guest', idToken: 'dev.' + btoa(JSON.stringify({ provider: 'phone', phone: GUEST_PHONE })) });
    expect(r.status).toBe(401);
  });
});

describe('Sessions', () => {
  it('student sessions are revoked when the registry phone changes (lost-phone recovery) or the student is deactivated', async () => {
    const c = makeClient();
    const tok = await c.reporter('student', STUDENT.phone);
    expect((await c.call('GET', '/api/me/complaints', undefined, tok)).status).toBe(200);
    const admin = await c.staff('boss@college.edu');
    const short = await c.call('POST', `/api/staff/registry/${STUDENT.sid}`, { phone: '+919000011111', note: 'x' }, admin);
    expect(short.status).toBe(422); // verification note required
    const upd = await c.call('POST', `/api/staff/registry/${STUDENT.sid}`, { phone: '+919000011111', note: 'Lost phone; college ID card checked in person' }, admin);
    expect(upd.status).toBe(200);
    expect((await c.call('GET', '/api/me/complaints', undefined, tok)).status).toBe(401);
    // old number can no longer sign in as student; new number can
    await expect(c.reporter('student', STUDENT.phone)).rejects.toThrow(/403/);
    const fresh = await c.reporter('student', '+919000011111');
    expect((await c.call('GET', '/api/me', undefined, fresh)).json.profile.studentId).toBe(STUDENT.sid);
    const log = (c.store as any).tables.Activity_Log.find((r: any) => r.action === 'registry_identity_updated');
    expect(log.details).not.toContain('9000011111'); // phones masked in audit log
  });

  it('blocked guests lose access and cannot sign in', async () => {
    const c = makeClient();
    const tok = await c.reporter('guest', GUEST_PHONE, 'guest-uid-1');
    const admin = await c.staff('boss@college.edu');
    expect((await c.call('POST', '/api/staff/guests/guest-uid-1/status', { status: 'blocked', note: 'spam reports' }, admin)).status).toBe(200);
    expect((await c.call('GET', '/api/me', undefined, tok)).status).toBe(401);
    await expect(c.reporter('guest', GUEST_PHONE, 'guest-uid-1')).rejects.toThrow(/403/);
  });

  it('staff access requires an active Staff_Roles entry or bootstrap admin, re-checked on every request', async () => {
    const c = makeClient();
    await expect(c.staff('random@college.edu')).rejects.toThrow(/403/);
    const admin = await c.staff('boss@college.edu');
    const clerk = await c.staff('clerk@college.edu');
    expect((await c.call('GET', '/api/staff/dashboard', undefined, clerk)).status).toBe(200);
    expect((await c.call('POST', '/api/staff/roles', { email: 'clerk@college.edu', role: 'admin', status: 'disabled' }, admin)).status).toBe(200);
    expect((await c.call('GET', '/api/staff/dashboard', undefined, clerk)).status).toBe(403);
    expect((await c.call('POST', '/api/staff/roles', { email: 'boss@college.edu', role: 'management' }, admin)).status).toBe(409); // no self-demotion
  });
});
