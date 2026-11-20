/**
 * Demo mode switch. In demo mode every API call is answered by an in-browser copy of the FindBack API
 * running on fictional data (src/demo/engine.ts). Nothing is sent to the real backend, Google Sheets or Firebase.
 * Demo sign-ins are only valid inside that in-browser engine: the production API rejects them
 * (Cloud Run always runs with development sign-in disabled, and uses different signing keys).
 */
import { clearSession } from './session';

const FLAG = 'fb2.demo';
export function isDemo(): boolean {
  try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
}
function changed() {
  window.dispatchEvent(new Event('fb-demo'));
}
export function enterDemo() {
  if (isDemo()) return;
  clearSession('reporter');
  clearSession('staff');
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* private mode: demo still works for this page */ }
  changed();
}
export function exitDemo() {
  clearSession('reporter');
  clearSession('staff');
  try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ }
  changed();
}
export async function demoFetch(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Response> {
  const { handleDemo } = await import('../demo/engine');
  return handleDemo(method, path, headers, body);
}
export async function resetDemo() {
  const { resetDemoData } = await import('../demo/engine');
  await resetDemoData();
  clearSession('reporter');
  clearSession('staff');
  changed();
}

/** Public demo credentials (fictional; they only work inside the in-browser demo). */
export const DEMO_ACCOUNTS = {
  student: { username: 'student@demo.findback', password: 'Student@123', phone: '+919000000001', label: 'Student', name: 'Aarav Sharma' },
  guest: { username: 'guest@demo.findback', password: 'Guest@123', phone: '+919000000101', label: 'Guest', name: 'Meera Iyer (visitor)' },
  admin: { username: 'admin@demo.findback', password: 'Admin@123', email: 'admin@demo.findback', label: 'Main Admin', name: 'Demo Admin' },
  management: { username: 'management@demo.findback', password: 'Management@123', email: 'management@demo.findback', label: 'Management', name: 'Demo Principal' },
} as const;
export type DemoRole = keyof typeof DEMO_ACCOUNTS;
