export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy': 'cross-origin',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Private data must never be stored by browsers, proxies or the SW.
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

export function errorResponse(e: HttpError): Response {
  return json({ ok: false, error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, e.status);
}

export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...headers })) r.headers.set(k, v);
  return r;
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-idempotency-key, x-client-channel',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export async function readJson<T = unknown>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get('content-length') || '0');
  if (len > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad_json', 'Invalid JSON body');
  }
}
