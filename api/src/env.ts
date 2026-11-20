export interface Env {
  /** Firebase / Identity Platform project ID (ID-token audience). */
  FIREBASE_PROJECT_ID?: string;
  /** Public Firebase web config served to the frontend (not secrets). */
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_APP_ID?: string;
  /** Secret pepper for keyed hashes (handover codes, IPs). Secret Manager. */
  HASH_PEPPER?: string;
  /** Secret for signing short-lived API session tokens. Secret Manager. */
  SESSION_KEY?: string;
  /** Comma-separated allowed browser origins. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated emails that are always Main Admin (bootstrap before Staff_Roles is filled). */
  BOOTSTRAP_ADMINS?: string;
  /** Optional Google Workspace domain restriction for staff (hd claim). */
  STAFF_DOMAIN?: string;
  /** 'staging' | 'production' — shown in the UI and health check. */
  DATA_ENV?: string;
  /** "development" enables the in-memory store and development sign-in. Never set on Cloud Run. */
  APP_ENV?: string;
  DEV_AUTH?: string;
}

export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
