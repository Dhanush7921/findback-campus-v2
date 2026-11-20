/**
 * Short-lived API bearer tokens only, in sessionStorage (cleared when the tab/app closes) — never localStorage.
 * Complaint data itself is held in memory only.
 */
export type Kind = 'reporter' | 'staff';
interface Stored { token: string; expiresAt: number; meta?: Record<string, string> }
const key = (k: Kind) => `fb2.session.${k}`;

export function saveSession(kind: Kind, token: string, expiresAt: number, meta?: Record<string, string>) {
  try { sessionStorage.setItem(key(kind), JSON.stringify({ token, expiresAt, meta } satisfies Stored)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('fb-session'));
}
export function getSession(kind: Kind): Stored | null {
  try {
    const raw = sessionStorage.getItem(key(kind));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s.expiresAt < Date.now()) { clearSession(kind); return null; }
    return s;
  } catch { return null; }
}
export function clearSession(kind: Kind) {
  try { sessionStorage.removeItem(key(kind)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('fb-session'));
}
