import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { MemoryStore } from '../src/store/memory';
import type { Store } from '../src/store/types';

export const ORIGIN = 'http://localhost:5173';
export const baseEnv: Env = {
  APP_ENV: 'development',
  DEV_AUTH: '1',
  HASH_PEPPER: 'test-pepper-0123456789abcdef',
  SESSION_KEY: 'test-session-key-0123456789abcd',
  ALLOWED_ORIGINS: ORIGIN,
  BOOTSTRAP_ADMINS: 'boss@college.edu',
};

export const STUDENT = { sid: '22CSE104', phone: '+919876543210', name: 'Asha Reddy', dept: 'CSE' };
export const STUDENT2 = { sid: '22ECE200', phone: '+919811112222', name: 'Ravi Kumar', dept: 'ECE' };
export const GUEST_PHONE = '+919900000001';
export const PROXY_PHONE = '+919900000099';

export const devToken = (d: { provider: string; phone?: string; email?: string; uid?: string }) => 'dev.' + btoa(JSON.stringify(d));

export function seed(store: MemoryStore) {
  const t = new Date().toISOString();
  for (const s of [STUDENT, STUDENT2]) {
    store.tables.Student_Registry.push({ student_id: s.sid, name: s.name, department: s.dept, year: 'II', phone: s.phone, email: '', status: 'active', sessions_valid_after: '', updated_at: t, updated_by: 'seed', notes: '', version: '1' });
  }
  store.tables.Staff_Roles.push({ email: 'clerk@college.edu', role: 'admin', name: 'Clerk', status: 'active', added_at: t, added_by: 'seed', updated_at: t, version: '1' });
  store.tables.Staff_Roles.push({ email: 'dean@college.edu', role: 'management', name: 'Dean', status: 'active', added_at: t, added_by: 'seed', updated_at: t, version: '1' });
}

export function makeClient(opts: { env?: Partial<Env>; store?: Store | null; fetchImpl?: typeof fetch } = {}) {
  const store = opts.store === undefined ? new MemoryStore() : opts.store;
  if (store instanceof MemoryStore && opts.store === undefined) seed(store);
  const handle = createApp({ env: { ...baseEnv, ...opts.env }, store, fetchImpl: opts.fetchImpl });
  let n = 0;
  async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, 'x-test-ip': `10.0.${n % 250}.${(n++ % 200) + 1}`, ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { /* csv / binary */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  async function reporter(portal: 'student' | 'guest', phone: string, uid?: string) {
    const r = await call('POST', '/api/auth/session', { portal, idToken: devToken({ provider: 'phone', phone, uid }) });
    if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.token as string;
  }
  async function staff(email: string) {
    const r = await call('POST', '/api/staff/session', { idToken: devToken({ provider: 'google.com', email }) });
    if (r.status !== 200) throw new Error(`staff login ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.token as string;
  }
  return { call, store, handle, reporter, staff };
}

export function complaintBody(over: Record<string, unknown> = {}) {
  return {
    category: 'Bag / Backpack',
    itemName: 'Black backpack',
    description: 'Black backpack with a laptop sleeve and two front pockets',
    colorFeatures: 'Black with red zipper pulls',
    lastSeenLocation: 'Central library, second floor',
    lostDate: new Date().toISOString().slice(0, 10),
    lostTime: '13:15',
    ownershipEvidence: 'There is a green notebook inside with my roll number on the cover',
    idempotencyKey: crypto.randomUUID(),
    elapsedMs: 15000,
    website: '',
    ...over,
  };
}

export const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAP/2Q==';
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
