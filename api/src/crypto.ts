const enc = new TextEncoder();
/** Crockford base32 without I, L, O, U — unambiguous when read aloud or printed. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(len: number): string {
  // Rejection-free: 32 symbols divides 256 evenly, so byte & 31 is unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return s;
}

/** Complaint ID: FB-XXXX-XXXX (40 random bits, unique-checked on insert). */
export const newComplaintId = () => `FB-${randomCode(4)}-${randomCode(4)}`;
export const newId = (prefix: string) => `${prefix}-${randomCode(8)}`;

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, k);
  }
  return k;
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 6-digit one-time handover code (uniform via rejection sampling). */
export function newHandoverCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, '0');
}

/** Keyed hash bound to a purpose and record, so values can't be swapped between rows. */
export async function keyedHash(pepper: string, purpose: string, recordId: string, value: string): Promise<string> {
  return 'h1$' + (await hmacHex(pepper, `${purpose}:v1:${recordId}:${value}`));
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
}

export interface ReporterSession { t: 'student' | 'guest'; uid: string; phone: string; sid?: string; iat: number; exp: number }
export interface StaffSession { t: 'staff'; uid: string; email: string; role: 'admin' | 'management'; iat: number; exp: number }
export type Session = ReporterSession | StaffSession;

export async function signSession(key: string, s: Session): Promise<string> {
  const body = b64url(JSON.stringify(s));
  return `${body}.${await hmacHex(key, 'sess:' + body)}`;
}

export async function verifySession(key: string, token: string | null): Promise<Session | null> {
  if (!token || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(await hmacHex(key, 'sess:' + body), sig)) return null;
  try {
    const s = JSON.parse(unb64url(body)) as Session;
    if (typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
