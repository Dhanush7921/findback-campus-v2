import { API_BASE, IS_NATIVE } from './env';
import { demoFetch, isDemo } from './demo';
import { clearSession, getSession, type Kind } from './session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

const inflight = new Map<string, Promise<unknown>>();

interface Opts { auth?: Kind; body?: unknown; signal?: AbortSignal; retries?: number; timeoutMs?: number }

export function apiConfigured() {
  return Boolean(API_BASE) || isDemo();
}

async function raw(method: string, path: string, o: Opts = {}): Promise<Response> {
  const demo = isDemo();
  if (!API_BASE && !demo) throw new ApiError(0, 'not_configured', 'The FindBack service is not connected yet. Please try again later.');
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  headers['x-client-channel'] = IS_NATIVE ? 'android' : window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web';
  if (o.auth) {
    const s = getSession(o.auth);
    if (!s) throw new ApiError(401, 'unauthorized', 'Your session expired. Please sign in again.');
    headers.authorization = `Bearer ${s.token}`;
  }
  const retries = o.retries ?? (method === 'GET' ? 2 : 0);
  let last: ApiError | null = null;
  for (let i = 0; i <= retries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 600 * 2 ** i * (0.6 + Math.random() * 0.8)));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30000);
    o.signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const payload = o.body === undefined ? undefined : JSON.stringify(o.body);
      // Demo mode never touches the network: requests go to the in-browser demo engine.
      const res = demo ? await demoFetch(method, path, headers, payload) : await fetch(API_BASE + path, { method, headers, body: payload, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      if (res.ok) return res;
      let j: { error?: string; message?: string; details?: Record<string, string> } = {};
      try { j = await res.json(); } catch { /* non-json */ }
      last = new ApiError(res.status, j.error ?? 'error', j.message ?? `Request failed (${res.status})`, j.details);
      if (res.status === 401 && o.auth) { clearSession(o.auth); throw last; }
      if (res.status !== 503 && res.status !== 502) throw last;
    } catch (e) {
      if (e instanceof ApiError && e.status !== 503 && e.status !== 502) throw e;
      if (o.signal?.aborted) throw new ApiError(0, 'aborted', 'Cancelled');
      last = e instanceof ApiError ? e : new ApiError(0, 'network', navigator.onLine ? 'Could not reach the server. Check your connection and try again.' : 'You appear to be offline. Reconnect and try again.');
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new ApiError(0, 'network', 'Request failed');
}

export async function apiGet<T>(path: string, o: Opts = {}): Promise<T> {
  // De-duplicate identical concurrent GETs (e.g. multiple components mounting).
  const k = `${o.auth ?? ''}:${path}`;
  const existing = inflight.get(k);
  if (existing) return existing as Promise<T>;
  const p = raw('GET', path, o).then((r) => r.json() as Promise<T>).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export async function apiPost<T>(path: string, body: unknown, o: Opts = {}): Promise<T> {
  return (await raw('POST', path, { ...o, body })).json() as Promise<T>;
}

export async function apiBlobUrl(path: string, auth: Kind): Promise<string> {
  const r = await raw('GET', path, { auth, retries: 1 });
  return URL.createObjectURL(await r.blob());
}

export async function apiDownload(path: string, auth: Kind, filename: string) {
  const r = await raw('GET', path, { auth, retries: 1 });
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
