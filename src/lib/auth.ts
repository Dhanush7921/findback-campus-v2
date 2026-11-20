import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import type { PublicConfig } from './config';
import { IS_NATIVE } from './env';

/**
 * Firebase Authentication is loaded on demand (only on sign-in screens) and used purely for identity proof:
 * the resulting ID token is exchanged with our API, which verifies it and applies registry / role checks.
 */
let authPromise: Promise<typeof import('firebase/auth') & { auth: import('firebase/auth').Auth }> | null = null;
function loadAuth(cfg: NonNullable<PublicConfig['auth']['firebase']>) {
  authPromise ??= (async () => {
    const [{ initializeApp }, mod] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const app = initializeApp(cfg);
    const auth = mod.initializeAuth(app, { persistence: mod.inMemoryPersistence, popupRedirectResolver: mod.browserPopupRedirectResolver });
    return { ...mod, auth };
  })();
  return authPromise;
}

const devToken = (d: object) => 'dev.' + btoa(JSON.stringify(d));

export interface OtpChallenge { confirm(code: string): Promise<string> }

let verifier: RecaptchaVerifier | null = null;

export async function sendOtp(config: PublicConfig, phoneE164: string, containerId: string): Promise<OtpChallenge> {
  if (config.auth.devAuth && !config.auth.firebase) {
    return { confirm: async (code) => { if (code !== '123456') throw new Error('Development code is 123456'); return devToken({ provider: 'phone', phone: phoneE164 }); } };
  }
  if (!config.auth.firebase) throw new Error('Phone sign-in is not configured yet.');
  const f = await loadAuth(config.auth.firebase);
  f.auth.languageCode = document.documentElement.lang === 'te' ? 'te' : 'en';
  verifier?.clear();
  verifier = new f.RecaptchaVerifier(f.auth, containerId, { size: 'invisible' });
  let result: ConfirmationResult;
  try {
    result = await f.signInWithPhoneNumber(f.auth, phoneE164, verifier);
  } catch (e) {
    verifier?.clear();
    verifier = null;
    throw new Error(friendly(e), { cause: e });
  }
  return {
    async confirm(code: string) {
      try {
        const cred = await result.confirm(code);
        return await cred.user.getIdToken();
      } catch (e) { throw new Error(friendly(e), { cause: e }); }
    },
  };
}

export async function googleIdToken(config: PublicConfig, devEmail?: string): Promise<string> {
  if (config.auth.devAuth && !config.auth.firebase) return devToken({ provider: 'google.com', email: devEmail ?? 'dev.admin@example.edu' });
  if (!config.auth.firebase) throw new Error('Staff sign-in is not configured yet.');
  if (IS_NATIVE) throw new Error('Staff sign-in is available on the website only. Open FindBack in your browser.');
  const f = await loadAuth(config.auth.firebase);
  const provider = new f.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', ...(config.auth.staffDomain ? { hd: config.auth.staffDomain } : {}) });
  try {
    const cred = await f.signInWithPopup(f.auth, provider);
    return await cred.user.getIdToken();
  } catch (e) { throw new Error(friendly(e), { cause: e }); }
}

export async function firebaseSignOut() {
  if (!authPromise) return;
  try { const f = await authPromise; await f.signOut(f.auth); } catch { /* ignore */ }
}

function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-phone-number': 'Enter a valid mobile number.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again later.',
    'auth/quota-exceeded': 'SMS limit reached for now. Please try again later.',
    'auth/invalid-verification-code': 'That code is not correct.',
    'auth/code-expired': 'The code expired. Request a new one.',
    'auth/captcha-check-failed': 'Verification check failed. Reload the page and try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'Allow pop-ups for this site to sign in.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled yet.',
  };
  return map[code] ?? 'Sign-in failed. Please try again.';
}
