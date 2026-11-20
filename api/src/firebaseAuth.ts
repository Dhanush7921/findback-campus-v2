import { HttpError } from './http';

interface Jwk { kid: string; n: string; e: string; kty: string }
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache: { keys: Jwk[]; exp: number } | null = null;

async function getJwks(fetchImpl: typeof fetch): Promise<Jwk[]> {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  let res: Response;
  try {
    res = await fetchImpl(JWKS_URL);
  } catch {
    throw new HttpError(503, 'auth_unavailable', 'Sign-in verification is temporarily unavailable.');
  }
  if (!res.ok) throw new HttpError(503, 'auth_unavailable', 'Sign-in verification is temporarily unavailable.');
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, exp: Date.now() + Math.min(Number(maxAge ?? 3600), 86400) * 1000 };
  return body.keys;
}
export function resetJwksCache() { jwksCache = null; }

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface FirebaseIdentity {
  uid: string;
  provider: string; // 'phone' | 'google.com' | ...
  phone?: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  authTime: number; // seconds
  hd?: string;
}

/**
 * Verifies a Firebase Authentication / Identity Platform ID token fully server-side
 * (RS256 signature against Google's securetoken keys, issuer, audience, expiry).
 * Firebase is used only for identity proof; authorization comes from our own records.
 */
export async function verifyFirebaseIdToken(token: string, projectId: string, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<FirebaseIdentity> {
  const bad = (m: string) => new HttpError(401, 'invalid_token', m);
  if (!projectId) throw new HttpError(503, 'auth_not_configured', 'Sign-in is not configured yet.');
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 4096) throw bad('Malformed token');
  let header: { alg?: string; kid?: string };
  let p: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    p = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    throw bad('Malformed token');
  }
  if (header.alg !== 'RS256') throw bad('Unsupported algorithm');
  const jwk = (await getJwks(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw bad('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad('Bad signature');
  const now = Math.floor(nowMs / 1000);
  if (p.iss !== `https://securetoken.google.com/${projectId}`) throw bad('Bad issuer');
  if (p.aud !== projectId) throw bad('Wrong audience');
  if (typeof p.exp !== 'number' || p.exp < now - 30) throw bad('Token expired');
  if (typeof p.iat !== 'number' || p.iat > now + 60) throw bad('Token issued in the future');
  if (typeof p.auth_time !== 'number' || p.auth_time > now + 60) throw bad('Bad auth time');
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) throw bad('Bad subject');
  const fb = (p.firebase ?? {}) as { sign_in_provider?: string };
  return {
    uid: p.sub,
    provider: String(fb.sign_in_provider ?? ''),
    phone: typeof p.phone_number === 'string' ? p.phone_number : undefined,
    email: typeof p.email === 'string' ? p.email.toLowerCase() : undefined,
    emailVerified: p.email_verified === true,
    name: typeof p.name === 'string' ? p.name : undefined,
    authTime: p.auth_time,
    hd: typeof p.hd === 'string' ? p.hd : undefined,
  };
}
