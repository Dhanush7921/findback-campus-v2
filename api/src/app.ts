import { z } from 'zod';
import {
  acknowledgeInput, archiveInput, claimDecisionInput, claimNoteInput, deliveredInput, foundItemEditInput, handoverCorrectionInput, myComplaintEditInput, staffComplaintCreateInput, staffComplaintEditInput, evidenceUpload, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_PER_ENTITY, claimInput, complaintInput, DEFAULT_SETTINGS, EDITABLE_SETTINGS,
  foundItemInput, FOUND_ITEM_STATUSES, handoverStartInput, imageUpload, MAX_IMAGE_BYTES, maskPhone, maskSensitive,
  normalizeStatus, OPEN_STATUSES, portalUpdateInput, proxyInput, registryRowInput, releaseInput, staffRoleInput,
  statusUpdateInput, STATUS_TRANSITIONS, WORKFLOW_STATUSES, type ComplaintStatus, type Row, type StaffRole,
} from '../../shared/domain';
import { keyedHash, newComplaintId, newHandoverCode, newId, safeEqual, sha256Hex, toHex, signSession, verifySession, type ReporterSession, type Session, type StaffSession } from './crypto';
import type { Env, RateLimit } from './env';
import { verifyFirebaseIdToken, type FirebaseIdentity } from './firebaseAuth';
import { corsHeaders, errorResponse, HttpError, json, readJson, withHeaders } from './http';
import { matchScore } from './matching';
import { LocalLimiter } from './ratelimit';
import { StoreError, type Op, type OpResult, type Store } from './store/types';

const REPORTER_TTL_MS = 30 * 60 * 1000;
const STAFF_TTL_MS = 4 * 60 * 60 * 1000;
/** A Firebase sign-in older than this must be repeated (fresh OTP / Google sign-in). */
const MAX_AUTH_AGE_S = 7 * 24 * 3600;
const HANDOVER_CODE_TTL_MS = 10 * 60 * 1000;
const HANDOVER_MAX_ATTEMPTS = 5;
const MAX_OPEN_COMPLAINTS = 10;
const DUPLICATE_WINDOW_MS = 7 * 86400e3;

export interface AppDeps {
  env: Env;
  store: Store | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Ctx {
  req: Request;
  url: URL;
  ip: string;
  ipHash: string;
  params: Record<string, string>;
}
type Handler = (c: Ctx) => Promise<Response>;
interface Actor { id: string; role: string }

// Single Cloud Run instance (max-instances=1) => these limiters are global.
// Campus Wi-Fi puts thousands of users behind few NAT IPs, so per-IP limits are generous and
// per-identity limits do the real work.
function makeLimiters() {
  return {
    api: new LocalLimiter(900, 60 * 1000),
    authIp: new LocalLimiter(120, 10 * 60 * 1000),
    authUid: new LocalLimiter(20, 60 * 60 * 1000),
    submitUid: new LocalLimiter(5, 60 * 60 * 1000),
    submitIp: new LocalLimiter(60, 10 * 60 * 1000),
    ackUid: new LocalLimiter(10, 10 * 60 * 1000),
  };
}

export function createApp(deps: AppDeps) {
  const { env } = deps;
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const isDev = env.APP_ENV === 'development';
  const devAuth = isDev && env.DEV_AUTH === '1';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const bootstrapAdmins = new Set((env.BOOTSTRAP_ADMINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')));
  const authEnabled = Boolean(env.FIREBASE_PROJECT_ID) || devAuth;
  const limiters = makeLimiters();
  const loginSeen = new Map<string, { at: number; uids: Set<string>; flagged: boolean }>();
  let settingsCache: { at: number; value: Record<string, string> } | null = null;
  let rolesCache: { at: number; value: Map<string, { role: StaffRole; name: string }> } | null = null;

  // ------------------------------------------------------------ helpers
  function store(): Store {
    if (!deps.store) throw new HttpError(503, 'not_configured', 'The data service is not configured yet.');
    return deps.store;
  }
  function secrets() {
    if (!env.HASH_PEPPER || !env.SESSION_KEY || env.HASH_PEPPER.length < 16 || env.SESSION_KEY.length < 16) {
      throw new HttpError(503, 'not_configured', 'Server secrets are not configured.');
    }
    return { pepper: env.HASH_PEPPER, sessionKey: env.SESSION_KEY };
  }
  const exec = (ops: Op[]) => store().exec(ops);
  const rowOf = (r: OpResult | undefined): Row | null => (r && r.ok ? (r.row ?? null) : null);
  const rowsOf = (r: OpResult | undefined): Row[] => (r && r.ok ? (r.rows ?? []) : []);
  const totalOf = (r: OpResult | undefined) => (r && r.ok ? (r.total ?? 0) : 0);
  async function limit(l: RateLimit, key: string, msg = 'Too many requests. Please wait a few minutes and try again.') {
    const { success } = await l.limit({ key });
    if (!success) throw new HttpError(429, 'rate_limited', msg);
  }
  function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
    const r = schema.safeParse(data);
    if (!r.success) {
      const details: Record<string, string> = {};
      for (const issue of r.error.issues) details[issue.path.join('.') || '_'] ??= issue.message;
      throw new HttpError(422, 'validation_failed', 'Please check the highlighted fields.', details);
    }
    return r.data;
  }
  function bearer(req: Request) {
    const h = req.headers.get('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  }
  function log(c: Ctx | null, actor: Actor, action: string, entity: string, entityId: string, details = ''): Op {
    return {
      op: 'append', table: 'Activity_Log',
      row: { log_id: newId('LG'), created_at: iso(), actor: actor.id, role: actor.role, action, entity, entity_id: entityId, details: details.slice(0, 500), ip_hash: c?.ipHash ?? '' },
    };
  }
  function update(cid: string, type: string, message: string, actor: string, opts: { itemId?: string; data?: unknown; visible?: boolean } = {}): Op {
    return {
      op: 'append', table: 'Complaint_Updates',
      row: {
        update_id: newId('UP'), created_at: iso(), complaint_id: cid, type, message, item_id: opts.itemId ?? '',
        data_json: opts.data ? JSON.stringify(opts.data) : '', visible_to_student: opts.visible === false ? 'false' : 'true', actor,
      },
    };
  }
  async function getSettings(): Promise<Record<string, string>> {
    if (settingsCache && now() - settingsCache.at < 60_000) return settingsCache.value;
    const rows = rowsOf((await exec([{ op: 'query', table: 'Application_Settings', limit: 200 }]))[0]);
    const value = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (EDITABLE_SETTINGS.includes(r.key)) value[r.key] = r.value;
    settingsCache = { at: now(), value };
    return value;
  }
  function retentionUntil(settings: Record<string, string>) {
    const days = Math.max(30, parseInt(settings.retention_days || '180', 10) || 180);
    return new Date(now() + days * 86400e3).toISOString();
  }
  function checkImage(img: z.output<typeof imageUpload>) {
    let bin: string;
    try { bin = atob(img.dataBase64); } catch { throw new HttpError(415, 'bad_image', 'Invalid image data.'); }
    if (bin.length === 0 || bin.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large', 'Images must be under 3 MB.');
    const b = (i: number) => bin.charCodeAt(i);
    const sig =
      (img.mime === 'image/jpeg' && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ||
      (img.mime === 'image/png' && b(0) === 0x89 && bin.slice(1, 4) === 'PNG') ||
      (img.mime === 'image/webp' && bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP');
    if (!sig) throw new HttpError(415, 'bad_image', 'Only JPEG, PNG or WebP images are accepted.');
  }
  async function uploadImage(raw: unknown, name: string) {
    const img = parse(imageUpload, raw);
    checkImage(img);
    return store().uploadFile(`${name}.${img.mime.split('/')[1]}`, img.mime, img.dataBase64);
  }
  /** Validates an evidence file by declared type AND magic bytes, and enforces the size limit. Returns decoded size + SHA-256. */
  async function checkEvidence(mime: string, dataBase64: string) {
    let bin: string;
    try { bin = atob(dataBase64); } catch { throw new HttpError(415, 'bad_file', 'Invalid file data.'); }
    if (bin.length === 0 || bin.length > MAX_EVIDENCE_BYTES) throw new HttpError(413, 'file_too_large', 'Each file must be under 5 MB.');
    const b = (i: number) => bin.charCodeAt(i);
    const sig =
      (mime === 'image/jpeg' && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ||
      (mime === 'image/png' && b(0) === 0x89 && bin.slice(1, 4) === 'PNG') ||
      (mime === 'image/webp' && bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP') ||
      (mime === 'application/pdf' && bin.slice(0, 5) === '%PDF-');
    if (!sig) throw new HttpError(415, 'bad_file', 'Only JPEG, PNG, WebP images or PDF documents are accepted, and the content must match the file type.');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { bytes: bin.length, sha256: toHex(await crypto.subtle.digest('SHA-256', bytes)) };
  }
  interface EvidenceArgs { entityType: 'found_item' | 'handover'; entityId: string; complaintId: string; kind: string; mime: string; dataBase64: string; caption: string }
  /** Uploads to the private bucket (create-only, never overwrites) and returns the append-only register row + audit entry. */
  async function storeEvidence(ctx: Ctx, actor: Actor, a: EvidenceArgs): Promise<{ evidenceId: string; fileId: string; ops: Op[] }> {
    const meta = await checkEvidence(a.mime, a.dataBase64);
    const evidenceId = newId('EV');
    const ext = a.mime === 'application/pdf' ? 'pdf' : a.mime.split('/')[1];
    const fileId = await store().uploadFile(`${a.entityId}-${evidenceId}.${ext}`, a.mime, a.dataBase64);
    return {
      evidenceId, fileId,
      ops: [
        { op: 'append', table: 'Evidence_Files', row: { evidence_id: evidenceId, created_at: iso(), entity_type: a.entityType, entity_id: a.entityId, complaint_id: a.complaintId, kind: a.kind, file_id: fileId, mime: a.mime, bytes: String(meta.bytes), sha256: meta.sha256, uploaded_by: actor.id, uploaded_role: actor.role, caption: a.caption } },
        log(ctx, actor, 'evidence_uploaded', a.entityType === 'found_item' ? 'FoundItem' : 'Handover', a.entityId, `${evidenceId} ${a.kind} ${a.mime} ${meta.bytes}B sha256:${meta.sha256.slice(0, 16)}`),
      ],
    };
  }
  async function evidenceFor(entityType: string, entityId: string, includeArchived = false) {
    const r = await exec([
      { op: 'query', table: 'Evidence_Files', where: { entity_type: entityType, entity_id: entityId }, limit: 200, order: 'asc' },
      { op: 'query', table: 'Evidence_Archive', where: { entity_type: entityType, entity_id: entityId }, limit: 200 },
    ]);
    const archived = new Map(rowsOf(r[1]).map((a) => [a.evidence_id, a]));
    return rowsOf(r[0]).map((e) => ({ ...e, archived_reason: archived.get(e.evidence_id)?.reason ?? '', archived_by: archived.get(e.evidence_id)?.archived_by ?? '' }) as Row).filter((e) => includeArchived || !e.archived_reason);
  }
  /** Human-readable before → after list for the audit log. */
  function diff(before: Row, after: Record<string, string>) {
    return Object.entries(after).filter(([k, v]) => (before[k] ?? '') !== v).map(([k, v]) => `${k}: "${(before[k] ?? '').slice(0, 60)}" → "${v.slice(0, 60)}"`);
  }
  function evidenceView(e: Row, redact: boolean) {
    const withheld = redact && e.kind === 'signature';
    return {
      evidenceId: e.evidence_id, createdAt: e.created_at, entityType: e.entity_type, entityId: e.entity_id, complaintId: e.complaint_id, kind: e.kind,
      mime: e.mime, bytes: Number(e.bytes) || 0, sha256: e.sha256, uploadedBy: redact && e.uploaded_role !== 'admin' ? 'Receiver (verified phone)' : e.uploaded_by,
      uploadedRole: e.uploaded_role, caption: redact ? maskSensitive(e.caption) : e.caption, withheld,
      archived: Boolean(e.archived_reason), archivedReason: redact ? '' : e.archived_reason, archivedBy: redact ? '' : e.archived_by,
    };
  }

  function transition(from: string, to: ComplaintStatus) {
    const allowed = STATUS_TRANSITIONS[normalizeStatus(from) as ComplaintStatus] ?? [];
    if (!allowed.includes(to)) throw new HttpError(409, 'invalid_transition', `Cannot move a complaint from "${normalizeStatus(from)}" to "${to}".`);
  }
  function mustOk(results: OpResult[], expected: number, what = 'record') {
    const failed = results.find((r) => !r.ok) as { ok: false; error: string } | undefined;
    if (failed) {
      if (failed.error === 'conflict') throw new HttpError(409, 'conflict', `This ${what} was changed by someone else. Refresh and try again.`);
      if (failed.error === 'not_found') throw new HttpError(404, 'not_found', `${what} not found.`);
      throw new HttpError(409, failed.error, `Could not save the ${what}.`);
    }
    if (results.length < expected) throw new HttpError(502, 'incomplete', 'The data service did not confirm every change.');
  }
  function safeJson(s: string): Record<string, unknown> {
    try { return s ? JSON.parse(s) : {}; } catch { return {}; }
  }
  function activeMatches(updates: Row[]) {
    const m = new Map<string, Row>();
    for (const u of [...updates].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (u.type === 'match_proposed') m.set(u.item_id, u);
      if (u.type === 'match_withdrawn') m.delete(u.item_id);
    }
    return m;
  }
  async function fileResponse(fileId: string) {
    const f = fileId ? await store().getFile(fileId) : null;
    if (!f) throw new HttpError(404, 'not_found', 'Image not found.');
    const bin = atob(f.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': f.mime, 'cache-control': 'private, no-store', 'content-disposition': 'inline' } });
  }
  function page(url: URL, size: number) {
    const p = Math.max(1, Math.min(10_000, parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
    return { page: p, offset: (p - 1) * size, limit: size };
  }

  // ------------------------------------------------------------ identity
  async function verifyIdToken(token: string): Promise<FirebaseIdentity> {
    if (devAuth && token.startsWith('dev.')) {
      // Development-only identities for local tests; unreachable on Cloud Run (APP_ENV is forced to production).
      const d = JSON.parse(atob(token.slice(4))) as { provider: string; phone?: string; email?: string; uid?: string };
      return { uid: d.uid ?? `dev-${d.phone ?? d.email}`, provider: d.provider, phone: d.phone, email: d.email?.toLowerCase(), emailVerified: Boolean(d.email), authTime: Math.floor(now() / 1000) };
    }
    const id = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID ?? '', deps.fetchImpl, now());
    if (Math.floor(now() / 1000) - id.authTime > MAX_AUTH_AGE_S) throw new HttpError(401, 'reauth_required', 'Please verify your phone again.');
    return id;
  }
  function trackLogin(c: Ctx, uid: string): Op | null {
    const e = loginSeen.get(c.ip) ?? { at: now(), uids: new Set<string>(), flagged: false };
    if (now() - e.at > 10 * 60 * 1000) { e.at = now(); e.uids.clear(); e.flagged = false; }
    e.uids.add(uid);
    loginSeen.set(c.ip, e);
    if (loginSeen.size > 20_000) loginSeen.clear();
    if (e.uids.size > 25 && !e.flagged) {
      e.flagged = true;
      return log(c, { id: 'system', role: 'system' }, 'suspicious_login_pattern', 'Auth', c.ipHash, `${e.uids.size} accounts from one network in 10 min`);
    }
    return null;
  }
  async function session(req: Request): Promise<Session | null> {
    return verifySession(secrets().sessionKey, bearer(req));
  }
  async function requireReporter(req: Request): Promise<ReporterSession> {
    const s = await session(req);
    if (!s || (s.t !== 'student' && s.t !== 'guest')) throw new HttpError(401, 'unauthorized', 'Your session has expired. Please verify your phone again.');
    // Re-validate on every request so registry changes / blocks / lost-phone resets take effect immediately.
    if (s.t === 'student') {
      const r = rowOf((await exec([{ op: 'get', table: 'Student_Registry', value: s.sid ?? '' }]))[0]);
      if (!r || r.status !== 'active' || r.phone !== s.phone || (r.sessions_valid_after && Date.parse(r.sessions_valid_after) > s.iat)) {
        throw new HttpError(401, 'unauthorized', 'Your session is no longer valid. Please sign in again.');
      }
    } else {
      const g = rowOf((await exec([{ op: 'get', table: 'Guest_Identities', value: s.uid }]))[0]);
      if (!g || g.status === 'blocked') throw new HttpError(401, 'unauthorized', 'Your session is no longer valid.');
    }
    return s;
  }
  const reporterActor = (s: ReporterSession): Actor => ({ id: s.t === 'student' ? `student:${s.sid}` : `guest:${s.uid}`, role: s.t });
  const staffActor = (s: StaffSession): Actor => ({ id: s.email, role: s.role });

  async function staffRoles() {
    if (rolesCache && now() - rolesCache.at < 30_000) return rolesCache.value;
    const value = new Map<string, { role: StaffRole; name: string }>();
    try {
      for (const r of rowsOf((await exec([{ op: 'query', table: 'Staff_Roles', limit: 1000 }]))[0])) {
        if (r.status === 'active' && (r.role === 'admin' || r.role === 'management')) value.set(r.email.toLowerCase(), { role: r.role, name: r.name });
      }
    } catch (e) {
      // Before the schema exists only bootstrap admins can sign in (so they can run the migration).
      if (!(e instanceof StoreError || e instanceof HttpError)) throw e;
    }
    rolesCache = { at: now(), value };
    return value;
  }
  async function roleOf(email: string): Promise<StaffRole | null> {
    if (bootstrapAdmins.has(email)) return 'admin';
    return (await staffRoles()).get(email)?.role ?? null;
  }
  /** Every /api/staff route requires admin; /api/mgmt routes accept management or admin (read-only by construction). */
  async function requireStaff(req: Request, allowed: StaffRole[]): Promise<StaffSession> {
    const s = await session(req);
    if (!s || s.t !== 'staff') throw new HttpError(401, 'unauthorized', 'Staff sign-in required.');
    const current = await roleOf(s.email);
    if (!current) throw new HttpError(403, 'forbidden', 'This account is no longer authorised.');
    if (!allowed.includes(current)) throw new HttpError(403, 'forbidden', current === 'management' ? 'Management access is read-only.' : 'Not permitted.');
    return { ...s, role: current };
  }
  const requireAdmin = (req: Request) => requireStaff(req, ['admin']);
  const requireMonitor = (req: Request) => requireStaff(req, ['admin', 'management']);

  // ------------------------------------------------------------ views
  function reporterComplaint(c: Row) {
    return {
      complaintId: c.complaint_id, createdAt: c.created_at, updatedAt: c.updated_at, status: normalizeStatus(c.status),
      reporterType: c.reporter_type, name: c.name, studentId: c.student_id, department: c.department, phone: maskPhone(c.verified_phone),
      email: c.email, category: c.category, itemName: c.item_name, description: c.description, colorFeatures: c.color_features,
      lastSeenLocation: c.last_seen_location, lostDate: c.lost_date, lostTime: c.lost_time, hasPhoto: Boolean(c.photo_file_id),
      ownershipEvidence: c.ownership_evidence, extraInfo: c.extra_info, visitInfo: c.visit_info, collectionInstructions: c.collection_instructions,
      proxy: c.proxy_phone ? { name: c.proxy_name, phone: maskPhone(c.proxy_phone), authorizedAt: c.proxy_authorized_at } : null,
    };
  }
  /** Management sees who reported and operational status, never contact details, evidence or private item data. */
  function mgmtView(c: Row) {
    return {
      complaint_id: c.complaint_id, created_at: c.created_at, updated_at: c.updated_at, status: normalizeStatus(c.status),
      reporter_type: c.reporter_type || 'Legacy', name: c.name, student_id: c.student_id, department: c.department,
      phone: maskPhone(c.verified_phone || c.phone), category: c.category, item_name: c.item_name,
      last_seen_location: c.last_seen_location, lost_date: c.lost_date, submission_channel: c.submission_channel, linked_item_id: c.linked_item_id,
    };
  }
  function publicItem(f: Row) {
    return { itemId: f.item_id, category: f.category, itemName: f.item_name, description: maskSensitive(f.public_description), colorFeatures: maskSensitive(f.color_features), foundLocation: f.found_location, foundDate: f.found_date, status: f.status, createdAt: f.created_at, registeredBy: f.registered_by };
  }
  function handoverView(h: Row, forReporter: boolean) {
    const base = {
      handoverId: h.handover_id, status: h.status || 'Released', complaintId: h.complaint_id, itemId: h.item_id, claimId: h.claim_id,
      receiverName: h.receiver_name, receiverType: h.receiver_type || 'owner', verificationMethod: h.verification_method || 'V1 staff ID check',
      startedAt: h.created_at, acknowledgedAt: h.acknowledged_at, releasedAt: h.released_at || (h.status ? '' : h.created_at),
      mode: h.mode || 'counter', deliveredAt: h.delivered_at,
    };
    if (forReporter) return base;
    return {
      ...base, approvedBy: h.approved_by, startedBy: h.started_by, releasedBy: h.handed_over_by, receiverIdType: h.receiver_id_type,
      receiverIdLast4: h.receiver_id_last4, receiverPhone: maskPhone(h.receiver_phone), receiverUid: h.receiver_uid, reporterUid: h.reporter_uid,
      ownerAuthorization: safeJson(h.owner_authorization), signatureName: h.signature_name, acknowledgmentText: h.acknowledgment_text,
      hasSignature: Boolean(h.evidence_file_id), evidenceFileId: h.evidence_file_id, notes: h.notes, challengeExpiresAt: h.challenge_expires_at,
      deliveryStaff: h.delivery_staff, deliveryAddress: h.delivery_address, dispatchedAt: h.dispatched_at, deliveredBy: h.delivered_by,
    };
  }

  // ------------------------------------------------------------ public
  const publicConfig: Handler = async () => {
    let settings = DEFAULT_SETTINGS;
    let degraded = false;
    try { settings = await getSettings(); } catch { degraded = true; }
    return json({
      ok: true, degraded,
      collectionOffice: settings.collection_office, collectionHours: settings.collection_hours,
      contactEmail: settings.contact_email, contactPhone: settings.contact_phone,
      submissionsOpen: settings.submissions_open !== 'false', guestReportsOpen: settings.guest_reports_open !== 'false',
      auth: {
        enabled: authEnabled, devAuth,
        firebase: env.FIREBASE_PROJECT_ID ? { apiKey: env.FIREBASE_API_KEY ?? '', authDomain: env.FIREBASE_AUTH_DOMAIN ?? `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`, projectId: env.FIREBASE_PROJECT_ID, appId: env.FIREBASE_APP_ID ?? '' } : null,
        staffDomain: env.STAFF_DOMAIN ?? '',
      },
      environment: isDev ? 'development' : env.DATA_ENV === 'production' ? 'production' : 'staging',
    });
  };

  const health: Handler = async () => {
    const configured = Boolean(deps.store && env.HASH_PEPPER && env.SESSION_KEY && authEnabled);
    let reachable = false;
    let schema: unknown = null;
    if (deps.store) {
      reachable = await deps.store.ping();
      if (!reachable && deps.store.schemaPlan) schema = await deps.store.schemaPlan().catch(() => null);
    }
    const ok = configured && reachable;
    return json({ ok, configured, storeReachable: reachable, authEnabled, dataEnv: env.DATA_ENV ?? 'staging', schemaPending: schema, time: iso() }, ok ? 200 : 503);
  };

  // ------------------------------------------------------------ reporter auth (phone OTP)
  const reporterSession: Handler = async (c) => {
    await limit(limiters.authIp, `auth:${c.ip}`);
    if (!authEnabled) throw new HttpError(503, 'auth_not_configured', 'Phone sign-in is not configured yet.');
    const { sessionKey } = secrets();
    const body = await readJson<{ idToken?: string; portal?: string }>(c.req);
    const portal = body?.portal === 'guest' ? 'guest' : body?.portal === 'student' ? 'student' : null;
    if (!portal) throw new HttpError(400, 'bad_request', 'Choose Student or Guest.');
    const id = await verifyIdToken(String(body?.idToken ?? ''));
    if (id.provider !== 'phone' || !id.phone) throw new HttpError(403, 'phone_required', 'Sign in with your mobile number.');
    await limit(limiters.authUid, `uid:${id.uid}`, 'Too many sign-ins for this number. Try again later.');
    const t = iso();
    const iat = now();
    const ops: Op[] = [];
    const flag = trackLogin(c, id.uid);
    if (flag) ops.push(flag);
    if (portal === 'student') {
      const matches = rowsOf((await exec([{ op: 'query', table: 'Student_Registry', where: { phone: id.phone, status: 'active' }, limit: 2 }]))[0]);
      if (matches.length !== 1) {
        await exec([...ops, log(c, { id: `uid:${id.uid}`, role: 'anonymous' }, matches.length ? 'student_login_ambiguous' : 'student_login_denied', 'Auth', maskPhone(id.phone))]).catch(() => undefined);
        throw new HttpError(403, matches.length ? 'registry_conflict' : 'not_in_registry',
          matches.length ? 'This number is linked to more than one student record. Please visit the office to correct it.'
            : 'This mobile number is not in the college student registry. Use Guest reporting, or visit the office to update your registered number.');
      }
      const r = matches[0];
      ops.push(log(c, { id: `student:${r.student_id}`, role: 'student' }, 'student_login', 'Auth', r.student_id));
      await exec(ops);
      const exp = now() + REPORTER_TTL_MS;
      const token = await signSession(sessionKey, { t: 'student', uid: id.uid, phone: id.phone, sid: r.student_id, iat, exp });
      return json({ ok: true, token, expiresAt: exp, profile: { type: 'Student', name: r.name, studentId: r.student_id, department: r.department, phone: maskPhone(id.phone) } });
    }
    const settings = await getSettings();
    if (settings.guest_reports_open === 'false') throw new HttpError(503, 'guests_closed', 'Guest reporting is paused by the office.');
    const g = rowOf((await exec([{ op: 'get', table: 'Guest_Identities', value: id.uid }]))[0]);
    if (g?.status === 'blocked') throw new HttpError(403, 'blocked', 'This guest account has been restricted. Please contact the office.');
    if (!g) ops.push({ op: 'append', table: 'Guest_Identities', row: { uid: id.uid, phone: id.phone, name: '', created_at: t, last_login_at: t, status: 'active', version: '1' } });
    else if (g.phone !== id.phone || now() - Date.parse(g.last_login_at || '1970') > 3600e3) ops.push({ op: 'update', table: 'Guest_Identities', value: id.uid, patch: { phone: id.phone, last_login_at: t } });
    ops.push(log(c, { id: `guest:${id.uid}`, role: 'guest' }, 'guest_login', 'Auth', maskPhone(id.phone)));
    mustOk(await exec(ops), ops.length, 'sign-in');
    const exp = now() + REPORTER_TTL_MS;
    const token = await signSession(sessionKey, { t: 'guest', uid: id.uid, phone: id.phone, iat, exp });
    return json({ ok: true, token, expiresAt: exp, profile: { type: 'Guest', name: g?.name ?? '', phone: maskPhone(id.phone) } });
  };

  const me: Handler = async ({ req }) => {
    const s = await requireReporter(req);
    if (s.t === 'student') {
      const r = rowOf((await exec([{ op: 'get', table: 'Student_Registry', value: s.sid ?? '' }]))[0])!;
      return json({ ok: true, profile: { type: 'Student', name: r.name, studentId: r.student_id, department: r.department, phone: maskPhone(s.phone) }, expiresAt: s.exp });
    }
    const g = rowOf((await exec([{ op: 'get', table: 'Guest_Identities', value: s.uid }]))[0]);
    return json({ ok: true, profile: { type: 'Guest', name: g?.name ?? '', phone: maskPhone(s.phone) }, expiresAt: s.exp });
  };

  // ------------------------------------------------------------ reporter complaints
  async function ownComplaints(s: ReporterSession) {
    return rowsOf((await exec([{ op: 'query', table: 'Complaints', where: { reporter_uid: s.uid }, limit: 200 }]))[0]);
  }
  async function loadOwn(s: ReporterSession, cid: string) {
    const r = await exec([
      { op: 'get', table: 'Complaints', value: cid },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: cid }, limit: 300, order: 'asc' },
      { op: 'query', table: 'Claim_Requests', where: { complaint_id: cid }, limit: 50 },
      { op: 'query', table: 'Handover_Records', where: { complaint_id: cid }, limit: 20 },
    ]);
    const c = rowOf(r[0]);
    // 404 (not 403) so complaint IDs of other people can't be probed.
    if (!c || !c.reporter_uid || c.reporter_uid !== s.uid) throw new HttpError(404, 'not_found', 'Complaint not found.');
    return { c, updates: rowsOf(r[1]), claims: rowsOf(r[2]), handovers: rowsOf(r[3]) };
  }

  const createComplaint: Handler = async (c) => {
    const s = await requireReporter(c.req);
    await limit(limiters.submitIp, `submit:${c.ip}`);
    const body = await readJson<Record<string, unknown>>(c.req, 4_500_000);
    if (typeof body.website === 'string' && body.website.length > 0) throw new HttpError(400, 'rejected', 'Submission rejected.');
    if (typeof body.elapsedMs !== 'number' || body.elapsedMs < 3000) throw new HttpError(400, 'too_fast', 'Please take a moment to review your details before submitting.');
    const idem = String(body.idempotencyKey ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(idem)) throw new HttpError(400, 'bad_request', 'Missing idempotency key.');
    const input = parse(complaintInput, body);
    const settings = await getSettings();
    if (settings.submissions_open === 'false') throw new HttpError(503, 'submissions_closed', 'New complaints are temporarily paused by the office.');

    // Identity is taken from the verified session and registry, never from the request body.
    let identity: { name: string; studentId: string; department: string; type: 'Student' | 'Guest' };
    if (s.t === 'student') {
      const r = rowOf((await exec([{ op: 'get', table: 'Student_Registry', value: s.sid ?? '' }]))[0])!;
      identity = { name: r.name, studentId: r.student_id, department: r.department, type: 'Student' };
    } else {
      if (settings.guest_reports_open === 'false') throw new HttpError(503, 'guests_closed', 'Guest reporting is paused by the office.');
      if (input.guestName.length < 2) throw new HttpError(422, 'validation_failed', 'Please check the highlighted fields.', { guestName: 'Enter your full name' });
      identity = { name: input.guestName, studentId: '', department: '', type: 'Guest' };
    }

    // Idempotent replay: the same key from the same reporter returns the original complaint.
    const existing = await ownComplaints(s);
    const replay = existing.find((x) => x.idempotency_key === idem);
    if (replay) return json({ ok: true, complaintId: replay.complaint_id, createdAt: replay.created_at, replayed: true });

    const open = existing.filter((x) => OPEN_STATUSES.includes(normalizeStatus(x.status) as ComplaintStatus));
    if (open.length >= MAX_OPEN_COMPLAINTS) throw new HttpError(429, 'too_many_open', `You already have ${open.length} open complaints. Please wait for them to be resolved or contact the office.`);
    const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const dup = open.find((x) => x.category === input.category && norm(x.item_name) === norm(input.itemName) && now() - Date.parse(x.created_at) < DUPLICATE_WINDOW_MS);
    if (dup && body.confirmNotDuplicate !== true) {
      throw new HttpError(409, 'possible_duplicate', `You reported a similar item recently (${dup.complaint_id}). Open that complaint, or confirm this is a different item.`, { complaintId: dup.complaint_id });
    }
    await limit(limiters.submitUid, `submit:${s.uid}`, 'You have submitted several complaints recently. Please wait an hour or contact the office.');

    let photoFileId = '';
    if (body.photo) photoFileId = await uploadImage(body.photo, `complaint-${idem.slice(0, 8)}`);
    const channelHdr = (c.req.headers.get('x-client-channel') ?? 'web').toLowerCase();
    const channel = ['web', 'android', 'ios', 'pwa'].includes(channelHdr) ? channelHdr : 'web';
    const actor = reporterActor(s);
    for (let attempt = 0; attempt < 3; attempt++) {
      const cid = newComplaintId();
      const t = iso();
      const ops: Op[] = [
        {
          op: 'append', table: 'Complaints', unique: 'idempotency_key',
          row: {
            complaint_id: cid, created_at: t, updated_at: t, status: 'Submitted', idempotency_key: idem,
            name: identity.name, student_id: identity.studentId, department: identity.department, phone: s.phone, email: input.email,
            category: input.category, item_name: input.itemName, description: input.description, color_features: input.colorFeatures,
            last_seen_location: input.lastSeenLocation, lost_date: input.lostDate, lost_time: input.lostTime,
            photo_file_id: photoFileId, ownership_evidence: input.ownershipEvidence, extra_info: '', linked_item_id: '',
            collection_instructions: '', staff_notes: '', retention_until: '', version: '1',
            reporter_uid: s.uid, reporter_type: identity.type, verified_phone: s.phone, submission_channel: channel,
            visit_info: input.visitInfo, proxy_name: '', proxy_phone: '', proxy_authorized_at: '', duplicate_of: dup ? dup.complaint_id : '',
          },
        },
        update(cid, 'status', 'Complaint submitted', actor.id, { data: { status: 'Submitted' } }),
        log(c, actor, 'complaint_submitted', 'Complaint', cid, `${identity.type}; channel ${channel}${dup ? `; reporter confirmed not a duplicate of ${dup.complaint_id}` : ''}`),
      ];
      if (s.t === 'guest') ops.push({ op: 'update', table: 'Guest_Identities', value: s.uid, patch: { name: identity.name } });
      const results = await exec(ops);
      const first = results[0];
      if (first && !first.ok && first.error === 'duplicate_key') continue; // ID collision: regenerate
      if (first && !first.ok && first.error === 'duplicate' && first.row) {
        if (first.row.reporter_uid !== s.uid) throw new HttpError(409, 'duplicate', 'This submission key was already used.');
        return json({ ok: true, complaintId: first.row.complaint_id, createdAt: first.row.created_at, replayed: true });
      }
      mustOk(results, ops.length, 'complaint');
      return json({ ok: true, complaintId: cid, createdAt: t }, 201);
    }
    throw new HttpError(503, 'id_generation_failed', 'Could not allocate a Complaint ID. Please retry.');
  };

  const myComplaints: Handler = async ({ req }) => {
    const s = await requireReporter(req);
    const rows = await ownComplaints(s);
    return json({ ok: true, rows: rows.map((c) => ({ complaintId: c.complaint_id, createdAt: c.created_at, updatedAt: c.updated_at, status: normalizeStatus(c.status), category: c.category, itemName: c.item_name, lastSeenLocation: c.last_seen_location })) });
  };

  const myComplaint: Handler = async ({ req, params }) => {
    const s = await requireReporter(req);
    const { c, updates, claims, handovers } = await loadOwn(s, params.id);
    const settings = await getSettings();
    const matches = [...activeMatches(updates).values()].map((u) => {
      const claim = claims.find((cl) => cl.item_id === u.item_id && cl.status !== 'Withdrawn');
      const item = safeJson(u.data_json);
      return { itemId: u.item_id, proposedAt: u.created_at, note: u.message, item: { ...item, description: maskSensitive(String(item.description ?? '')) }, claimStatus: claim?.status ?? null };
    });
    const timeline = updates.filter((u) => u.type === 'status').map((u) => ({ status: normalizeStatus(String(safeJson(u.data_json).status ?? '')), at: u.created_at, message: u.message }));
    const messages = updates.filter((u) => u.visible_to_student === 'true' && u.type !== 'status').map((u) => ({ id: u.update_id, type: u.type, message: u.message, at: u.created_at }));
    const released = handovers.find((h) => (h.status || 'Released') === 'Released');
    const pending = handovers.find((h) => h.status === 'Pending Acknowledgment');
    return json({
      ok: true,
      complaint: reporterComplaint(c),
      timeline, messages, matches,
      claims: claims.map((cl) => ({ claimId: cl.claim_id, itemId: cl.item_id, status: cl.status, createdAt: cl.created_at, decisionNotes: ['Rejected', 'Approved', 'Disputed'].includes(cl.status) ? cl.decision_notes : '' })),
      collection: { office: settings.collection_office, hours: settings.collection_hours, instructions: c.collection_instructions, contactEmail: settings.contact_email, contactPhone: settings.contact_phone },
      pendingHandover: pending && pending.receiver_type !== 'proxy' ? { handoverId: pending.handover_id, expiresAt: pending.challenge_expires_at } : null,
      receipt: released ? handoverView(released, true) : null,
    });
  };

  const myNotifications: Handler = async ({ req }) => {
    const s = await requireReporter(req);
    const own = (await ownComplaints(s)).slice(0, 20);
    if (!own.length) return json({ ok: true, rows: [] });
    const r = await exec(own.map((c) => ({ op: 'query', table: 'Complaint_Updates', where: { complaint_id: c.complaint_id, visible_to_student: 'true' }, limit: 20 }) as Op));
    const rows = r.flatMap(rowsOf).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)
      .map((u) => ({ id: u.update_id, complaintId: u.complaint_id, type: u.type, message: u.message, at: u.created_at }));
    return json({ ok: true, rows });
  };

  const myUpdate: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    const input = parse(portalUpdateInput, await readJson(ctx.req));
    const { c } = await loadOwn(s, ctx.params.id);
    if (!OPEN_STATUSES.includes(normalizeStatus(c.status) as ComplaintStatus)) throw new HttpError(409, 'closed', 'This complaint is closed and can no longer be updated.');
    const patch: Row = { updated_at: iso() };
    const changes: string[] = [];
    if (input.email && input.email !== c.email) { patch.email = input.email; changes.push('email'); }
    if (input.extraInfo) {
      patch.extra_info = ((c.extra_info ? c.extra_info + '\n' : '') + `[${iso().slice(0, 10)}] ${input.extraInfo}`);
      if (patch.extra_info.length > 3000) throw new HttpError(422, 'validation_failed', 'Additional information limit reached. Please contact the office.');
      changes.push('additional information');
    }
    if (!changes.length) throw new HttpError(422, 'validation_failed', 'Nothing to update.');
    const actor = reporterActor(s);
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch, expectVersion: c.version },
      update(c.complaint_id, 'reporter_update', `You updated: ${changes.join(', ')}`, actor.id),
      log(ctx, actor, 'complaint_updated', 'Complaint', c.complaint_id, changes.join(',')),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true });
  };

  const myClaim: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    const body = await readJson<Record<string, unknown>>(ctx.req, 4_500_000);
    const input = parse(claimInput, body);
    const { c, updates, claims } = await loadOwn(s, ctx.params.id);
    if (!activeMatches(updates).has(input.itemId)) throw new HttpError(404, 'not_found', 'This item is not a proposed match for your complaint.');
    if (claims.some((cl) => ['Pending', 'Disputed', 'Approved', 'Completed'].includes(cl.status))) throw new HttpError(409, 'already_claimed', 'You already have an active claim on this complaint.');
    transition(c.status, 'Ownership Verification');
    const claimId = newId('CL');
    const evidenceFile = body.evidencePhoto ? await uploadImage(body.evidencePhoto, `claim-${claimId}`) : '';
    const t = iso();
    const actor = reporterActor(s);
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Ownership Verification', updated_at: t }, expectVersion: c.version },
      { op: 'append', table: 'Claim_Requests', row: { claim_id: claimId, created_at: t, complaint_id: c.complaint_id, item_id: input.itemId, evidence: input.evidence, status: 'Pending', reviewed_by: '', reviewed_at: '', decision_notes: '', checks_json: '', version: '1', claimant_uid: s.uid, evidence_file_id: evidenceFile } },
      update(c.complaint_id, 'status', 'Ownership evidence submitted. The office will verify it.', actor.id, { itemId: input.itemId, data: { status: 'Ownership Verification' } }),
      log(ctx, actor, 'claim_requested', 'Claim', claimId, `item ${input.itemId}`),
    ]);
    mustOk(r, 4, 'claim');
    return json({ ok: true, claimId }, 201);
  };

  const myCancel: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    const body = (await readJson<{ reason?: string }>(ctx.req)) ?? {};
    const reason = String(body.reason ?? '').slice(0, 300).trim();
    const { c, claims } = await loadOwn(s, ctx.params.id);
    transition(c.status, 'Cancelled');
    const settings = await getSettings();
    const actor = reporterActor(s);
    const ops: Op[] = [
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Cancelled', updated_at: iso(), retention_until: retentionUntil(settings) }, expectVersion: c.version },
      update(c.complaint_id, 'status', reason ? `Cancelled by you: ${reason}` : 'Cancelled by you', actor.id, { data: { status: 'Cancelled' } }),
      log(ctx, actor, 'complaint_cancelled_by_reporter', 'Complaint', c.complaint_id, reason),
    ];
    for (const cl of claims.filter((x) => ['Pending', 'Disputed', 'Approved'].includes(x.status))) ops.push({ op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Withdrawn' } });
    mustOk(await exec(ops), ops.length, 'complaint');
    return json({ ok: true });
  };

  const myProxy: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    const input = parse(proxyInput, await readJson(ctx.req));
    const { c } = await loadOwn(s, ctx.params.id);
    if (normalizeStatus(c.status) !== 'Ready for Collection') throw new HttpError(409, 'invalid_state', 'You can authorise someone to collect only when the item is ready for collection.');
    if (input.proxyPhone === s.phone) throw new HttpError(422, 'validation_failed', 'Enter the mobile number of the person collecting for you.', { proxyPhone: 'Must be a different number' });
    const t = iso();
    const actor = reporterActor(s);
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { proxy_name: input.proxyName, proxy_phone: input.proxyPhone, proxy_authorized_at: t, updated_at: t }, expectVersion: c.version },
      update(c.complaint_id, 'proxy_authorized', `You authorised ${input.proxyName} (${maskPhone(input.proxyPhone)}) to collect on your behalf. They must verify their phone at collection.`, actor.id),
      log(ctx, actor, 'proxy_authorized', 'Complaint', c.complaint_id, `${input.proxyName} ${maskPhone(input.proxyPhone)}`),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true });
  };

  const myPhoto: Handler = async ({ req, params }) => {
    const s = await requireReporter(req);
    const { c } = await loadOwn(s, params.id);
    return fileResponse(c.photo_file_id);
  };

  // ------------------------------------------------------------ receiver acknowledgment
  function receiverMatches(h: Row, s: ReporterSession) {
    if (h.receiver_type === 'proxy') return h.receiver_phone === s.phone;
    return h.reporter_uid === s.uid && h.receiver_phone === s.phone;
  }
  const myPendingHandovers: Handler = async ({ req }) => {
    const s = await requireReporter(req);
    const rows = rowsOf((await exec([{ op: 'query', table: 'Handover_Records', where: { status: 'Pending Acknowledgment' }, limit: 500 }]))[0])
      .filter((h) => receiverMatches(h, s) && Date.parse(h.challenge_expires_at) > now());
    if (!rows.length) return json({ ok: true, rows: [] });
    const items = await exec(rows.slice(0, 10).map((h) => ({ op: 'get', table: 'Found_Items', value: h.item_id }) as Op));
    return json({
      ok: true,
      rows: rows.slice(0, 10).map((h, i) => {
        const f = rowOf(items[i]);
        return { handoverId: h.handover_id, complaintId: h.complaint_id, receiverType: h.receiver_type, receiverName: h.receiver_name, expiresAt: h.challenge_expires_at, item: f ? { itemName: f.item_name, category: f.category } : null };
      }),
    });
  };

  const acknowledge: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    await limit(limiters.ackUid, `ack:${s.uid}`);
    const { pepper } = secrets();
    const body = await readJson<Record<string, unknown>>(ctx.req, 4_500_000);
    const input = parse(acknowledgeInput, body);
    const h = rowOf((await exec([{ op: 'get', table: 'Handover_Records', value: ctx.params.id }]))[0]);
    if (!h || !receiverMatches(h, s)) throw new HttpError(404, 'not_found', 'Handover not found.');
    if (h.status !== 'Pending Acknowledgment') throw new HttpError(409, 'already_used', 'This handover code has already been used or cancelled.');
    const actor = reporterActor(s);
    if (Date.parse(h.challenge_expires_at) <= now()) throw new HttpError(410, 'expired', 'This code has expired. Ask the office to generate a new one.');
    const candidate = await keyedHash(pepper, 'handover', h.handover_id, input.code);
    if (!h.challenge_hash || !safeEqual(candidate, h.challenge_hash)) {
      const attempts = (parseInt(h.challenge_attempts || '0', 10) || 0) + 1;
      const ops: Op[] = [];
      if (attempts >= HANDOVER_MAX_ATTEMPTS) {
        ops.push({ op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { challenge_attempts: String(attempts), status: 'Cancelled', challenge_hash: '' }, expectVersion: h.version });
        const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: h.complaint_id }]))[0]);
        if (c && normalizeStatus(c.status) === 'Awaiting Receiver Confirmation') ops.push({ op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Ready for Collection', updated_at: iso() }, expectVersion: c.version });
        ops.push(log(ctx, actor, 'handover_code_locked', 'Handover', h.handover_id, `${attempts} wrong codes`));
      } else {
        ops.push({ op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { challenge_attempts: String(attempts) }, expectVersion: h.version });
        ops.push(log(ctx, actor, 'handover_code_failed', 'Handover', h.handover_id, `attempt ${attempts}`));
      }
      await exec(ops);
      throw new HttpError(401, 'wrong_code', attempts >= HANDOVER_MAX_ATTEMPTS ? 'Too many wrong codes. The office must start the handover again.' : 'That code is not correct.');
    }
    const sigOps: Op[] = [];
    let evidence = '';
    if (input.signature) {
      checkImage(input.signature);
      const st = await storeEvidence(ctx, actor, { entityType: 'handover', entityId: h.handover_id, complaintId: h.complaint_id, kind: 'signature', mime: input.signature.mime, dataBase64: input.signature.dataBase64, caption: `Signature of ${input.signatureName}` });
      evidence = st.fileId;
      sigOps.push(...st.ops);
    }
    const t = iso();
    const delivery = h.mode === 'delivery';
    const text = `I, ${input.signatureName}, confirm that I have physically received the item for complaint ${h.complaint_id} (found item ${h.item_id}) ${delivery ? `delivered to me by ${h.delivery_staff}` : 'from the college office'}${h.receiver_type === 'proxy' ? ' on behalf of the owner, who authorised me' : ''}.`;
    const r = await exec([
      {
        op: 'update', table: 'Handover_Records', value: h.handover_id, expectVersion: h.version,
        patch: { status: 'Acknowledged', challenge_hash: '', receiver_uid: s.uid, acknowledged_at: t, signature_name: input.signatureName, acknowledgment_text: text, evidence_file_id: evidence, verification_method: `${h.receiver_type === 'proxy' ? 'proxy' : 'owner'} phone OTP + one-time ${delivery ? 'doorstep' : 'desk'} code + ${h.receiver_id_type} (…${h.receiver_id_last4}) checked by ${delivery ? `delivery staff ${h.delivery_staff}` : 'staff'}` },
      },
      update(h.complaint_id, 'receipt_acknowledged', `${h.receiver_type === 'proxy' ? 'Your authorised collector' : 'You'} confirmed receipt${delivery ? ' of the delivery' : ' at the counter'}. Waiting for the office to confirm release.`, actor.id),
      log(ctx, actor, 'receipt_acknowledged', 'Handover', h.handover_id, `${h.complaint_id} / ${h.item_id}${delivery ? ' (home delivery)' : ''}`),
      ...sigOps,
    ]);
    mustOk(r, 3 + sigOps.length, 'handover');
    return json({ ok: true, handoverId: h.handover_id, acknowledgedAt: t });
  };

  // ------------------------------------------------------------ staff auth (Google sign-in via Firebase)
  const staffSession: Handler = async (c) => {
    await limit(limiters.authIp, `staff:${c.ip}`);
    if (!authEnabled) throw new HttpError(503, 'auth_not_configured', 'Staff sign-in is not configured yet.');
    const { sessionKey } = secrets();
    const body = await readJson<{ idToken?: string }>(c.req);
    const id = await verifyIdToken(String(body?.idToken ?? ''));
    if (id.provider !== 'google.com' || !id.email || !id.emailVerified) throw new HttpError(403, 'google_required', 'Sign in with your Google account.');
    if (env.STAFF_DOMAIN && !id.email.endsWith(`@${env.STAFF_DOMAIN}`) && !bootstrapAdmins.has(id.email)) throw new HttpError(403, 'forbidden', 'Use your institutional Google account.');
    const role = await roleOf(id.email);
    if (!role) {
      await exec([log(c, { id: id.email, role: 'anonymous' }, 'staff_login_denied', 'Auth', id.email)]).catch(() => undefined);
      throw new HttpError(403, 'forbidden', 'This account is not authorised for staff access.');
    }
    const iat = now();
    const exp = iat + STAFF_TTL_MS;
    const token = await signSession(sessionKey, { t: 'staff', uid: id.uid, email: id.email, role, iat, exp });
    await exec([log(c, { id: id.email, role }, 'staff_login', 'Auth', id.email)]).catch(() => undefined);
    return json({ ok: true, token, email: id.email, role, name: id.name ?? (await staffRoles()).get(id.email)?.name ?? '', expiresAt: exp });
  };

  const staffMe: Handler = async ({ req }) => {
    const s = await requireStaff(req, ['admin', 'management']);
    return json({ ok: true, email: s.email, role: s.role, expiresAt: s.exp });
  };

  // ------------------------------------------------------------ admin: complaints
  const dashboard: Handler = async ({ req }) => {
    await requireAdmin(req);
    const r = await exec([
      { op: 'query', table: 'Complaints', columns: ['complaint_id', 'created_at', 'status', 'category', 'item_name', 'reporter_type', 'name'], limit: 5000 },
      { op: 'query', table: 'Found_Items', columns: ['item_id', 'created_at', 'status', 'category', 'item_name', 'found_date'], limit: 5000 },
      { op: 'query', table: 'Claim_Requests', where: { status: 'Pending' }, limit: 100 },
      { op: 'query', table: 'Handover_Records', where: { status: 'Acknowledged' }, limit: 100 },
      { op: 'query', table: 'Activity_Log', limit: 8 },
    ]);
    const complaints = rowsOf(r[0]).map((c) => ({ ...c, status: normalizeStatus(c.status) }));
    const items = rowsOf(r[1]);
    const byStatus: Record<string, number> = {};
    for (const c of complaints) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const itemsByStatus: Record<string, number> = {};
    for (const i of items) itemsByStatus[i.status] = (itemsByStatus[i.status] ?? 0) + 1;
    return json({
      ok: true,
      totals: { complaints: totalOf(r[0]), foundItems: totalOf(r[1]), pendingClaims: rowsOf(r[2]).length, awaitingRelease: rowsOf(r[3]).length },
      byStatus, itemsByStatus,
      recentComplaints: complaints.slice(0, 6),
      recentItems: items.slice(0, 6),
      pendingClaims: rowsOf(r[2]).slice(0, 6).map((c) => ({ claimId: c.claim_id, complaintId: c.complaint_id, itemId: c.item_id, createdAt: c.created_at })),
      awaitingRelease: rowsOf(r[3]).slice(0, 6).map((h) => handoverView(h, false)),
      recentActivity: rowsOf(r[4]),
    });
  };

  const listComplaints: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const status = url.searchParams.get('status') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const q = (url.searchParams.get('q') ?? '').trim().toUpperCase();
    const pg = page(url, 25);
    const columns = ['complaint_id', 'created_at', 'updated_at', 'status', 'category', 'item_name', 'name', 'student_id', 'department', 'reporter_type', 'last_seen_location', 'lost_date'];
    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (type) where.reporter_type = type;
    if (q) where[/^FB-/.test(q) ? 'complaint_id' : 'student_id'] = q;
    const r = await exec([{ op: 'query', table: 'Complaints', where, columns, offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]).map((c) => ({ ...c, status: normalizeStatus(c.status) })), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const getComplaint: Handler = async ({ req, params }) => {
    await requireAdmin(req);
    const r = await exec([
      { op: 'get', table: 'Complaints', value: params.id },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: params.id }, limit: 300, order: 'asc' },
      { op: 'query', table: 'Claim_Requests', where: { complaint_id: params.id }, limit: 50 },
      { op: 'query', table: 'Found_Items', where: { status: 'In Storage' }, limit: 2000 },
      { op: 'query', table: 'Handover_Records', where: { complaint_id: params.id }, limit: 20 },
    ]);
    const c = rowOf(r[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const updates = rowsOf(r[1]);
    const active = activeMatches(updates);
    const suggestions = rowsOf(r[3])
      .filter((f) => !active.has(f.item_id))
      .map((f) => ({ item: f, score: matchScore(c, f) }))
      .filter((s) => s.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const { idempotency_key: _i, ...complaint } = c;
    const status = normalizeStatus(c.status) as ComplaintStatus;
    return json({
      ok: true,
      complaint: { ...complaint, status },
      reporter: { type: c.reporter_type || 'Legacy (V1)', uid: c.reporter_uid, verifiedPhone: c.verified_phone, name: c.name, studentId: c.student_id, department: c.department, channel: c.submission_channel },
      updates,
      claims: rowsOf(r[2]),
      handovers: rowsOf(r[4]).map((h) => handoverView(h, false)),
      activeMatches: [...active.values()].map((u) => ({ itemId: u.item_id, at: u.created_at, item: safeJson(u.data_json), note: u.message })),
      suggestions,
      allowedTransitions: (STATUS_TRANSITIONS[status] ?? []).filter((x) => !WORKFLOW_STATUSES.includes(x) || (status === 'Unclaimed' && x === 'Ready for Collection')),
    });
  };

  const setStatus: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(statusUpdateInput, await readJson(ctx.req));
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: ctx.params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const from = normalizeStatus(c.status);
    if (WORKFLOW_STATUSES.includes(input.status) && !(from === 'Unclaimed' && input.status === 'Ready for Collection')) {
      throw new HttpError(409, 'use_workflow', 'This status is set by the claim verification and handover workflow.');
    }
    transition(from, input.status);
    const settings = await getSettings();
    const patch: Row = { status: input.status, updated_at: iso() };
    if (['Closed', 'Rejected', 'Cancelled'].includes(input.status)) patch.retention_until = retentionUntil(settings);
    if (input.note) patch.staff_notes = (c.staff_notes ? c.staff_notes + '\n' : '') + `[${iso().slice(0, 16)} ${s.email}] ${input.note}`;
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch, expectVersion: c.version },
      update(c.complaint_id, 'status', input.note && ['Closed', 'Rejected'].includes(input.status) ? `${input.status}: ${input.note}` : `Status changed to ${input.status}`, s.email, { data: { status: input.status } }),
      log(ctx, staffActor(s), 'status_changed', 'Complaint', c.complaint_id, `${from} -> ${input.status}`),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true });
  };

  const addNote: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ note?: string; visibleToStudent?: boolean }>(ctx.req);
    const note = String(body?.note ?? '').trim().slice(0, 500);
    if (note.length < 2) throw new HttpError(422, 'validation_failed', 'Write a note.', { note: 'Required' });
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: ctx.params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const r = await exec([
      update(c.complaint_id, 'note', note, s.email, { visible: body?.visibleToStudent === true }),
      log(ctx, staffActor(s), body?.visibleToStudent ? 'message_sent' : 'note_added', 'Complaint', c.complaint_id),
    ]);
    mustOk(r, 2, 'note');
    return json({ ok: true });
  };

  const proposeMatch: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ itemId?: string; note?: string }>(ctx.req);
    const itemId = String(body?.itemId ?? '');
    const r0 = await exec([
      { op: 'get', table: 'Complaints', value: ctx.params.id },
      { op: 'get', table: 'Found_Items', value: itemId },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: ctx.params.id }, limit: 300 },
    ]);
    const c = rowOf(r0[0]);
    const f = rowOf(r0[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Complaint or item not found.');
    const status = normalizeStatus(c.status);
    if (!['In Storage', 'Matched'].includes(f.status)) throw new HttpError(409, 'item_unavailable', `Item is ${f.status}.`);
    if (!['Submitted', 'Under Review', 'Potential Match', 'Ownership Verification', 'Disputed'].includes(status)) throw new HttpError(409, 'invalid_transition', `Complaint is ${status}.`);
    if (activeMatches(rowsOf(r0[2])).has(itemId)) throw new HttpError(409, 'already_proposed', 'Already proposed.');
    const t = iso();
    const ops: Op[] = [];
    if (status === 'Submitted' || status === 'Under Review') {
      ops.push({ op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Potential Match', updated_at: t }, expectVersion: c.version });
      ops.push(update(c.complaint_id, 'status', 'A possible match was found', s.email, { data: { status: 'Potential Match' } }));
    }
    // Reporters only ever see this masked snapshot — never private details, storage location or photos.
    const snap = { category: f.category, itemName: f.item_name, description: maskSensitive(f.public_description), colorFeatures: maskSensitive(f.color_features), foundLocation: f.found_location, foundDate: f.found_date };
    ops.push(update(c.complaint_id, 'match_proposed', String(body?.note ?? '').slice(0, 300) || 'The office found an item that may be yours. Review it and submit ownership evidence if it is yours.', s.email, { itemId, data: snap }));
    ops.push({ op: 'update', table: 'Found_Items', value: itemId, patch: { status: 'Matched', matched_complaint_id: f.matched_complaint_id || c.complaint_id, updated_at: t } });
    ops.push(log(ctx, staffActor(s), 'match_proposed', 'Complaint', c.complaint_id, `item ${itemId}`));
    mustOk(await exec(ops), ops.length, 'match');
    return json({ ok: true });
  };

  const withdrawMatch: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ itemId?: string }>(ctx.req);
    const itemId = String(body?.itemId ?? '');
    const r0 = await exec([
      { op: 'get', table: 'Found_Items', value: itemId },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: ctx.params.id }, limit: 300 },
    ]);
    const f = rowOf(r0[0]);
    if (!f || !activeMatches(rowsOf(r0[1])).has(itemId)) throw new HttpError(404, 'not_found', 'Match not found.');
    const ops: Op[] = [update(ctx.params.id, 'match_withdrawn', 'A proposed match was withdrawn after review.', s.email, { itemId })];
    if (f.status === 'Matched' && f.matched_complaint_id === ctx.params.id) ops.push({ op: 'update', table: 'Found_Items', value: itemId, patch: { status: 'In Storage', matched_complaint_id: '', updated_at: iso() } });
    ops.push(log(ctx, staffActor(s), 'match_withdrawn', 'Complaint', ctx.params.id, `item ${itemId}`));
    mustOk(await exec(ops), ops.length, 'match');
    return json({ ok: true });
  };

  // ------------------------------------------------------------ admin: found items
  const listFound: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const status = url.searchParams.get('status') ?? '';
    const category = url.searchParams.get('category') ?? '';
    const pg = page(url, 24);
    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (category) where.category = category;
    const r = await exec([{ op: 'query', table: 'Found_Items', where, offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const createFound: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<Record<string, unknown>>(ctx.req, 13_000_000);
    const input = parse(foundItemInput, body);
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 3).map((p) => parse(imageUpload, p)) : [];
    photos.forEach(checkImage);
    const itemId = newId('FI');
    const ids: string[] = [];
    const evOps: Op[] = [];
    for (const p of photos) {
      const st = await storeEvidence(ctx, staffActor(s), { entityType: 'found_item', entityId: itemId, complaintId: '', kind: 'item_photo', mime: p.mime, dataBase64: p.dataBase64, caption: '' });
      ids.push(st.fileId);
      evOps.push(...st.ops);
    }
    const t = iso();
    const r = await exec([
      {
        op: 'append', table: 'Found_Items',
        row: {
          item_id: itemId, created_at: t, updated_at: t, status: 'In Storage', category: input.category, item_name: input.itemName,
          public_description: input.publicDescription, private_details: input.privateDetails, color_features: input.colorFeatures,
          found_location: input.foundLocation, found_date: input.foundDate, storage_location: input.storageLocation,
          photo_file_ids: ids.join(','), registered_by: s.email, matched_complaint_id: '', version: '1', found_time: input.foundTime,
        },
      },
      log(ctx, staffActor(s), 'found_item_registered', 'FoundItem', itemId, input.itemName),
      ...evOps,
    ]);
    mustOk(r, 2 + evOps.length, 'found item');
    return json({ ok: true, itemId }, 201);
  };

  const getFound: Handler = async ({ req, params }) => {
    await requireAdmin(req);
    const r = await exec([
      { op: 'get', table: 'Found_Items', value: params.id },
      { op: 'query', table: 'Claim_Requests', where: { item_id: params.id }, limit: 50 },
      { op: 'query', table: 'Complaints', columns: ['complaint_id', 'item_name', 'category', 'description', 'color_features', 'last_seen_location', 'lost_date', 'status', 'created_at', 'name', 'reporter_type'], limit: 5000 },
    ]);
    const f = rowOf(r[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    const candidates = rowsOf(r[2])
      .filter((c) => ['Submitted', 'Under Review', 'Potential Match'].includes(normalizeStatus(c.status)))
      .map((c) => ({ complaint: { ...c, status: normalizeStatus(c.status) }, score: matchScore(c, f) }))
      .filter((x) => x.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return json({ ok: true, item: f, claims: rowsOf(r[1]), suggestions: candidates });
  };

  const setFoundStatus: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ status?: string; note?: string; storageLocation?: string }>(ctx.req);
    const status = String(body?.status ?? '');
    if (!['In Storage', 'Donated', 'Disposed'].includes(status) || !FOUND_ITEM_STATUSES.includes(status as never)) throw new HttpError(422, 'validation_failed', 'Choose In Storage, Donated or Disposed.');
    const note = String(body?.note ?? '').trim().slice(0, 300);
    const f = rowOf((await exec([{ op: 'get', table: 'Found_Items', value: ctx.params.id }]))[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    if (['Claimed', 'Returned'].includes(f.status)) throw new HttpError(409, 'invalid_transition', `Item is ${f.status}.`);
    if ((status === 'Donated' || status === 'Disposed') && note.length < 3) throw new HttpError(422, 'validation_failed', 'Record a disposal note.', { note: 'Required' });
    const patch: Row = { status, updated_at: iso() };
    if (body?.storageLocation) patch.storage_location = String(body.storageLocation).slice(0, 120);
    const r = await exec([
      { op: 'update', table: 'Found_Items', value: f.item_id, patch, expectVersion: f.version },
      log(ctx, staffActor(s), 'found_item_status', 'FoundItem', f.item_id, `${f.status} -> ${status}${note ? ': ' + note : ''}`),
    ]);
    mustOk(r, 2, 'found item');
    return json({ ok: true });
  };

  // ------------------------------------------------------------ admin: claims
  const listClaims: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const status = url.searchParams.get('status') ?? 'Pending';
    const r = await exec([{ op: 'query', table: 'Claim_Requests', where: status ? { status } : {}, limit: 100 }]);
    const claims = rowsOf(r[0]);
    if (!claims.length) return json({ ok: true, rows: [] });
    const ops: Op[] = [];
    for (const cl of claims.slice(0, 12)) {
      ops.push({ op: 'get', table: 'Complaints', value: cl.complaint_id });
      ops.push({ op: 'get', table: 'Found_Items', value: cl.item_id });
    }
    const rr = await exec(ops);
    const rows = claims.map((cl, i) => {
      if (i >= 12) return { claim: cl, complaint: null, item: null };
      const c = rowOf(rr[i * 2]);
      const f = rowOf(rr[i * 2 + 1]);
      return {
        claim: cl,
        complaint: c && { complaint_id: c.complaint_id, name: c.name, student_id: c.student_id, department: c.department, reporter_type: c.reporter_type, verified_phone: c.verified_phone, item_name: c.item_name, description: c.description, color_features: c.color_features, ownership_evidence: c.ownership_evidence, status: normalizeStatus(c.status), version: c.version },
        item: f && { item_id: f.item_id, item_name: f.item_name, public_description: f.public_description, private_details: f.private_details, color_features: f.color_features, status: f.status, storage_location: f.storage_location, photo_file_ids: f.photo_file_ids },
      };
    });
    return json({ ok: true, rows, total: claims.length });
  };

  const decideClaim: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(claimDecisionInput, await readJson(ctx.req));
    const cl = rowOf((await exec([{ op: 'get', table: 'Claim_Requests', value: ctx.params.id }]))[0]);
    if (!cl) throw new HttpError(404, 'not_found', 'Claim not found.');
    if (cl.status !== 'Pending' && cl.status !== 'Disputed') throw new HttpError(409, 'already_decided', `Claim is already ${cl.status}.`);
    if (input.decision === 'dispute' && cl.status === 'Disputed') throw new HttpError(409, 'already_decided', 'Claim is already disputed.');
    const r1 = await exec([
      { op: 'get', table: 'Complaints', value: cl.complaint_id },
      { op: 'get', table: 'Found_Items', value: cl.item_id },
      { op: 'query', table: 'Claim_Requests', where: { item_id: cl.item_id, status: 'Approved' }, limit: 5 },
    ]);
    const c = rowOf(r1[0]);
    const f = rowOf(r1[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Linked complaint or item missing.');
    const t = iso();
    const actor = staffActor(s);
    const settings = await getSettings();
    if (input.decision === 'approve') {
      const ch = input.checks;
      if (!ch || !ch.evidenceMatches || !ch.featuresMatch || !ch.noConflictingClaims) throw new HttpError(422, 'checks_required', 'All verification checks must be confirmed before approval.');
      if (rowsOf(r1[2]).length) throw new HttpError(409, 'conflict', 'Another claim for this item is already approved.');
      transition(c.status, 'Ready for Collection');
      const instructions = input.collectionInstructions || `Collect from ${settings.collection_office} (${settings.collection_hours}). Bring your college ID or government photo ID and the phone you used to report. You will confirm receipt on your phone at the counter.`;
      const r = await exec([
        { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Approved', reviewed_by: s.email, reviewed_at: t, decision_notes: input.notes, checks_json: JSON.stringify(ch) }, expectVersion: cl.version },
        { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Ready for Collection', linked_item_id: f.item_id, collection_instructions: instructions, updated_at: t }, expectVersion: c.version },
        { op: 'update', table: 'Found_Items', value: f.item_id, patch: { status: 'Claimed', matched_complaint_id: c.complaint_id, updated_at: t } },
        update(c.complaint_id, 'status', 'Ownership verified. Your item is ready for collection.', s.email, { itemId: f.item_id, data: { status: 'Ready for Collection' } }),
        log(ctx, actor, 'claim_approved', 'Claim', cl.claim_id, input.notes),
      ]);
      mustOk(r, 5, 'claim');
    } else if (input.decision === 'dispute') {
      transition(c.status, 'Disputed');
      const r = await exec([
        { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Disputed', reviewed_by: s.email, reviewed_at: t, decision_notes: input.notes }, expectVersion: cl.version },
        { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Disputed', updated_at: t }, expectVersion: c.version },
        update(c.complaint_id, 'status', `Ownership is disputed and needs further review: ${input.notes}`, s.email, { itemId: f.item_id, data: { status: 'Disputed' } }),
        log(ctx, actor, 'claim_disputed', 'Claim', cl.claim_id, input.notes),
      ]);
      mustOk(r, 4, 'claim');
    } else {
      transition(c.status, 'Potential Match');
      const r = await exec([
        { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Rejected', reviewed_by: s.email, reviewed_at: t, decision_notes: input.notes }, expectVersion: cl.version },
        { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Potential Match', updated_at: t }, expectVersion: c.version },
        update(c.complaint_id, 'status', `Claim could not be verified: ${input.notes}`, s.email, { itemId: f.item_id, data: { status: 'Potential Match' } }),
        log(ctx, actor, 'claim_rejected', 'Claim', cl.claim_id, input.notes),
      ]);
      mustOk(r, 4, 'claim');
    }
    return json({ ok: true });
  };

  // ------------------------------------------------------------ admin: receiver-confirmed handover
  const listHandovers: Handler = async ({ req }) => {
    await requireAdmin(req);
    const r = await exec([
      { op: 'query', table: 'Claim_Requests', where: { status: 'Approved' }, limit: 100 },
      { op: 'query', table: 'Handover_Records', limit: 100 },
    ]);
    const ready = rowsOf(r[0]);
    const cs = ready.length ? await exec(ready.slice(0, 20).map((cl) => ({ op: 'get', table: 'Complaints', value: cl.complaint_id }) as Op)) : [];
    return json({
      ok: true,
      ready: ready.map((cl, i) => {
        const c = rowOf(cs[i]);
        return { ...cl, complaint: c && { complaint_id: c.complaint_id, name: c.name, reporter_type: c.reporter_type, student_id: c.student_id, status: normalizeStatus(c.status), item_name: c.item_name, proxy_name: c.proxy_name, proxy_phone: maskPhone(c.proxy_phone), verified_phone: maskPhone(c.verified_phone) } };
      }),
      recent: rowsOf(r[1]).map((h) => handoverView(h, false)),
      policy: await (async () => {
        const st = await getSettings();
        const admins = [...(await staffRoles()).entries()].filter(([, v]) => v.role === 'admin').map(([email]) => email);
        return { homeDelivery: st.home_delivery_enabled === 'true', proofRequired: st.handover_proof_required === 'true', twoStaff: st.require_two_staff === 'true', deliveryStaff: [...new Set([...admins, ...bootstrapAdmins])].sort() };
      })(),
    });
  };

  const startHandover: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const { pepper } = secrets();
    const input = parse(handoverStartInput, await readJson(ctx.req));
    const cl = rowOf((await exec([{ op: 'get', table: 'Claim_Requests', value: input.claimId }]))[0]);
    if (!cl) throw new HttpError(404, 'not_found', 'Claim not found.');
    if (cl.status !== 'Approved') throw new HttpError(409, 'not_approved', 'Only approved claims can be handed over.');
    const r1 = await exec([
      { op: 'get', table: 'Complaints', value: cl.complaint_id },
      { op: 'get', table: 'Found_Items', value: cl.item_id },
      { op: 'query', table: 'Handover_Records', where: { claim_id: cl.claim_id }, limit: 20 },
    ]);
    const c = rowOf(r1[0]);
    const f = rowOf(r1[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Linked complaint or item missing.');
    if (!c.reporter_uid || !c.verified_phone) throw new HttpError(409, 'legacy_complaint', 'This V1 complaint has no verified reporter account. Ask the owner to report through the Student or Guest portal so receipt can be confirmed.');
    const existing = rowsOf(r1[2]);
    if (existing.some((h) => h.status === 'Released' || h.status === 'Acknowledged')) throw new HttpError(409, 'handover_in_progress', 'This claim already has an acknowledged or completed handover.');
    const ops: Op[] = [];
    for (const h of existing.filter((x) => x.status === 'Pending Acknowledgment')) {
      if (Date.parse(h.challenge_expires_at) > now()) throw new HttpError(409, 'handover_in_progress', 'A handover code is already active for this claim. Cancel it first to issue a new one.');
      ops.push({ op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { status: 'Expired', challenge_hash: '' }, expectVersion: h.version });
    }
    let expectedPhone = c.verified_phone;
    let ownerAuth = '';
    if (input.receiverType === 'proxy') {
      if (!c.proxy_phone || !c.proxy_authorized_at) throw new HttpError(409, 'no_proxy_authorization', 'The owner has not authorised anyone to collect on their behalf. They can do this from their portal.');
      expectedPhone = c.proxy_phone;
      ownerAuth = JSON.stringify({ proxyName: c.proxy_name, proxyPhone: maskPhone(c.proxy_phone), authorizedAt: c.proxy_authorized_at, authorizedBy: c.reporter_uid });
    }
    const status = normalizeStatus(c.status);
    if (status !== 'Ready for Collection' && status !== 'Awaiting Receiver Confirmation') throw new HttpError(409, 'invalid_transition', `Complaint is ${status}.`);
    const delivery = input.mode === 'delivery';
    if (delivery) {
      if ((await getSettings()).home_delivery_enabled !== 'true') throw new HttpError(409, 'delivery_disabled', 'Home delivery is not enabled in Settings.');
      if ((await roleOf(input.deliveryStaff)) !== 'admin') throw new HttpError(422, 'validation_failed', 'Delivery staff must be an active Main Admin staff member.', { deliveryStaff: 'Not an active staff member' });
    }
    const handoverId = newId('HO');
    // Counter: code shown now at the desk. Delivery: the assigned delivery staff issues the code at the doorstep.
    const code = delivery ? '' : newHandoverCode();
    const t = iso();
    const expires = delivery ? '' : new Date(now() + HANDOVER_CODE_TTL_MS).toISOString();
    if (status === 'Ready for Collection') ops.push({ op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Awaiting Receiver Confirmation', updated_at: t }, expectVersion: c.version });
    ops.push(
      {
        op: 'append', table: 'Handover_Records',
        row: {
          handover_id: handoverId, created_at: t, complaint_id: c.complaint_id, item_id: f.item_id, claim_id: cl.claim_id,
          receiver_name: input.receiverName, receiver_id_checked: 'true', approved_by: cl.reviewed_by, handed_over_by: '', notes: input.notes,
          status: 'Pending Acknowledgment', started_by: s.email, reporter_uid: c.reporter_uid, receiver_type: input.receiverType, owner_authorization: ownerAuth,
          receiver_uid: '', receiver_phone: expectedPhone, receiver_id_type: input.receiverIdType, receiver_id_last4: input.receiverIdLast4.toUpperCase(),
          verification_method: '', challenge_hash: delivery ? '' : await keyedHash(pepper, 'handover', handoverId, code), challenge_expires_at: expires, challenge_attempts: '0',
          acknowledged_at: '', signature_name: '', acknowledgment_text: '', evidence_file_id: '', released_at: '', version: '1',
          mode: input.mode, delivery_staff: delivery ? input.deliveryStaff : '', delivery_address: delivery ? input.deliveryAddress : '', dispatched_at: delivery ? t : '', delivered_at: '', delivered_by: '',
        },
      },
      update(c.complaint_id, 'status', delivery ? 'Your item is out for home delivery. When it arrives, the delivery staff will give you a code to confirm receipt in your portal.' : input.receiverType === 'proxy' ? `Collection started for your authorised collector ${input.receiverName}. They must confirm receipt on their phone.` : 'Collection started at the counter. Enter the code shown by the office in your portal to confirm receipt.', s.email, { itemId: f.item_id, data: { status: 'Awaiting Receiver Confirmation' } }),
      log(ctx, staffActor(s), 'handover_started', 'Handover', handoverId, `${c.complaint_id} / ${f.item_id}; receiver ${input.receiverType}; ${input.receiverIdType} …${input.receiverIdLast4}${delivery ? `; home delivery by ${input.deliveryStaff}` : ''}`),
    );
    mustOk(await exec(ops), ops.length, 'handover');
    // The code is shown once on the staff screen; only its keyed hash is stored.
    return json({ ok: true, handoverId, code: code || null, expiresAt: expires || null, mode: input.mode, receiverPhone: maskPhone(expectedPhone) }, 201);
  };

  async function loadHandover(id: string) {
    const h = rowOf((await exec([{ op: 'get', table: 'Handover_Records', value: id }]))[0]);
    if (!h) throw new HttpError(404, 'not_found', 'Handover not found.');
    return h;
  }

  const getHandover: Handler = async ({ req, params }) => {
    await requireAdmin(req);
    const h = await loadHandover(params.id);
    return json({ ok: true, handover: handoverView(h, false) });
  };

  const releaseHandover: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(releaseInput, await readJson(ctx.req));
    const h = await loadHandover(ctx.params.id);
    if (h.status === 'Released') throw new HttpError(409, 'already_released', 'This item has already been released.');
    const delivery = h.mode === 'delivery';
    if (!h.receiver_uid || !h.acknowledged_at || !['Acknowledged', 'Delivered'].includes(h.status)) throw new HttpError(409, 'not_acknowledged', 'The receiver has not confirmed receipt yet.');
    if (delivery && (h.status !== 'Delivered' || !h.delivered_at)) throw new HttpError(409, 'not_delivered', 'The delivery staff has not recorded the delivery and its proof yet.');
    const settings = await getSettings();
    if (settings.require_two_staff === 'true' && h.approved_by === s.email) throw new HttpError(409, 'two_staff_required', 'A different staff member from the claim approver must confirm release.');
    if (settings.require_two_staff === 'true' && delivery && h.delivered_by === s.email) throw new HttpError(409, 'two_staff_required', 'A different staff member from the delivery staff must finalise the delivery.');
    if (!delivery && settings.handover_proof_required === 'true') {
      const proof = (await evidenceFor('handover', h.handover_id)).filter((e) => e.kind === 'handover_photo' || e.kind === 'handover_document');
      if (!proof.length) throw new HttpError(409, 'proof_required', 'College policy requires a handover photo or document. Upload it in Proof of Handover first.');
    }
    const r1 = await exec([
      { op: 'get', table: 'Complaints', value: h.complaint_id },
      { op: 'get', table: 'Found_Items', value: h.item_id },
      { op: 'get', table: 'Claim_Requests', value: h.claim_id },
    ]);
    const c = rowOf(r1[0]);
    const f = rowOf(r1[1]);
    const cl = rowOf(r1[2]);
    if (!c || !f || !cl) throw new HttpError(404, 'not_found', 'Linked records missing.');
    if (cl.status !== 'Approved') throw new HttpError(409, 'not_approved', `Claim is ${cl.status}.`);
    transition(c.status, 'Returned');
    const t = iso();
    const r = await exec([
      { op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { status: 'Released', handed_over_by: s.email, released_at: t, notes: [h.notes, input.notes].filter(Boolean).join('\n').slice(0, 1000) }, expectVersion: h.version },
      { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Completed' }, expectVersion: cl.version },
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Returned', updated_at: t, retention_until: retentionUntil(settings) }, expectVersion: c.version },
      { op: 'update', table: 'Found_Items', value: f.item_id, patch: { status: 'Returned', updated_at: t } },
      update(c.complaint_id, 'status', `Item returned. Handover receipt ${h.handover_id}.`, s.email, { itemId: f.item_id, data: { status: 'Returned' } }),
      log(ctx, staffActor(s), 'item_released', 'Handover', h.handover_id, `${c.complaint_id} / ${f.item_id}; receiver ${h.receiver_type} ${h.receiver_name}; approved by ${h.approved_by}; acknowledged ${h.acknowledged_at}${delivery ? `; delivered by ${h.delivered_by} at ${h.delivered_at}` : ''}`),
    ]);
    mustOk(r, 6, 'handover');
    return json({ ok: true, handoverId: h.handover_id, releasedAt: t });
  };

  const cancelHandover: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ reason?: string }>(ctx.req);
    const reason = String(body?.reason ?? '').trim().slice(0, 300);
    if (reason.length < 3) throw new HttpError(422, 'validation_failed', 'Give a reason.', { reason: 'Required' });
    const h = await loadHandover(ctx.params.id);
    if (h.status !== 'Pending Acknowledgment' && h.status !== 'Acknowledged') throw new HttpError(409, 'invalid_state', `Handover is ${h.status || 'Released'}.`);
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: h.complaint_id }]))[0]);
    const ops: Op[] = [{ op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { status: 'Cancelled', challenge_hash: '', notes: [h.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n') }, expectVersion: h.version }];
    if (c && normalizeStatus(c.status) === 'Awaiting Receiver Confirmation') {
      ops.push({ op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Ready for Collection', updated_at: iso() }, expectVersion: c.version });
      ops.push(update(c.complaint_id, 'status', 'Collection was not completed. Your item is still ready for collection.', s.email, { data: { status: 'Ready for Collection' } }));
    }
    ops.push(log(ctx, staffActor(s), 'handover_cancelled', 'Handover', h.handover_id, reason));
    mustOk(await exec(ops), ops.length, 'handover');
    return json({ ok: true });
  };

  // ------------------------------------------------------------ evidence + home delivery
  const foundEvidenceUpload: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(evidenceUpload, await readJson(ctx.req, 7_500_000));
    if (input.kind !== 'item_photo') throw new HttpError(422, 'validation_failed', 'Found items take item photos.', { kind: 'item_photo only' });
    const f = rowOf((await exec([{ op: 'get', table: 'Found_Items', value: ctx.params.id }]))[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    if ((await evidenceFor('found_item', f.item_id)).length >= MAX_EVIDENCE_PER_ENTITY) throw new HttpError(409, 'too_many_files', `At most ${MAX_EVIDENCE_PER_ENTITY} files per item.`);
    const st = await storeEvidence(ctx, staffActor(s), { entityType: 'found_item', entityId: f.item_id, complaintId: f.matched_complaint_id, kind: input.kind, mime: input.mime, dataBase64: input.dataBase64, caption: input.caption });
    const ops: Op[] = [...st.ops];
    if (input.mime !== 'application/pdf') ops.push({ op: 'update', table: 'Found_Items', value: f.item_id, patch: { photo_file_ids: [f.photo_file_ids, st.fileId].filter(Boolean).join(','), updated_at: iso() } });
    mustOk(await exec(ops), ops.length, 'evidence');
    return json({ ok: true, evidenceId: st.evidenceId }, 201);
  };

  const handoverEvidenceUpload: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(evidenceUpload, await readJson(ctx.req, 7_500_000));
    if (input.kind === 'item_photo') throw new HttpError(422, 'validation_failed', 'Choose a handover evidence type.', { kind: 'Invalid' });
    const h = await loadHandover(ctx.params.id);
    // Evidence is frozen once a handover is finalised or cancelled: nothing can be added, replaced or removed afterwards.
    if (!['Pending Acknowledgment', 'Acknowledged', 'Delivered'].includes(h.status)) throw new HttpError(409, 'evidence_locked', `Evidence is locked: handover is ${h.status || 'Released'}.`);
    if (input.kind === 'delivery_proof') {
      if (h.mode !== 'delivery') throw new HttpError(409, 'not_delivery', 'Delivery proof applies to home deliveries only.');
      if (h.delivery_staff !== s.email) throw new HttpError(403, 'forbidden', 'Only the assigned delivery staff can upload delivery proof.');
    }
    if ((await evidenceFor('handover', h.handover_id)).length >= MAX_EVIDENCE_PER_ENTITY) throw new HttpError(409, 'too_many_files', `At most ${MAX_EVIDENCE_PER_ENTITY} files per handover.`);
    const st = await storeEvidence(ctx, staffActor(s), { entityType: 'handover', entityId: h.handover_id, complaintId: h.complaint_id, kind: input.kind, mime: input.mime, dataBase64: input.dataBase64, caption: input.caption });
    mustOk(await exec(st.ops), st.ops.length, 'evidence');
    return json({ ok: true, evidenceId: st.evidenceId }, 201);
  };

  const deliveryCode: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const { pepper } = secrets();
    const h = await loadHandover(ctx.params.id);
    if (h.mode !== 'delivery') throw new HttpError(409, 'not_delivery', 'This is a counter handover.');
    if (h.delivery_staff !== s.email) throw new HttpError(403, 'forbidden', 'Only the assigned delivery staff can issue the doorstep code.');
    if (h.status !== 'Pending Acknowledgment') throw new HttpError(409, 'already_used', `Handover is ${h.status}.`);
    const code = newHandoverCode();
    const expires = new Date(now() + HANDOVER_CODE_TTL_MS).toISOString();
    const ops: Op[] = [
      { op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { challenge_hash: await keyedHash(pepper, 'handover', h.handover_id, code), challenge_expires_at: expires }, expectVersion: h.version },
      log(ctx, staffActor(s), 'delivery_code_issued', 'Handover', h.handover_id, h.complaint_id),
    ];
    mustOk(await exec(ops), 2, 'handover');
    return json({ ok: true, code, expiresAt: expires, receiverPhone: maskPhone(h.receiver_phone) });
  };

  const markDelivered: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(deliveredInput, await readJson(ctx.req));
    const h = await loadHandover(ctx.params.id);
    if (h.mode !== 'delivery') throw new HttpError(409, 'not_delivery', 'This is a counter handover.');
    if (h.delivery_staff !== s.email) throw new HttpError(403, 'forbidden', 'Only the assigned delivery staff can record the delivery.');
    if (h.status === 'Delivered' || h.status === 'Released') throw new HttpError(409, 'already_delivered', 'Delivery already recorded.');
    if (h.status !== 'Acknowledged' || !h.acknowledged_at) throw new HttpError(409, 'not_acknowledged', 'The recipient has not confirmed receipt yet.');
    const proof = (await evidenceFor('handover', h.handover_id)).filter((e) => e.kind === 'delivery_proof');
    if (!proof.length) throw new HttpError(409, 'proof_required', 'Upload a delivery proof photo first.');
    const t = iso();
    const ops: Op[] = [
      { op: 'update', table: 'Handover_Records', value: h.handover_id, patch: { status: 'Delivered', delivered_at: t, delivered_by: s.email, notes: [h.notes, input.notes && `Delivery: ${input.notes}`].filter(Boolean).join('\n').slice(0, 1000) }, expectVersion: h.version },
      log(ctx, staffActor(s), 'item_delivered', 'Handover', h.handover_id, `${h.complaint_id}; ${proof.length} proof file(s); awaiting staff finalisation`),
    ];
    mustOk(await exec(ops), 2, 'handover');
    return json({ ok: true, deliveredAt: t });
  };

  const ENTITY_TYPES = new Set(['found_item', 'handover']);
  const listEvidence = (redact: boolean): Handler => async ({ req, url }) => {
    if (redact) await requireMonitor(req); else await requireAdmin(req);
    const type = url.searchParams.get('type') ?? '';
    const id = url.searchParams.get('id') ?? '';
    if (!ENTITY_TYPES.has(type) || !/^(FI|HO)-[0-9A-Z]{8}$/.test(id)) throw new HttpError(422, 'validation_failed', 'type and id are required.');
    return json({ ok: true, rows: (await evidenceFor(type, id, !redact)).map((e) => evidenceView(e, redact)) });
  };
  const evidenceFile = (redact: boolean): Handler => async (ctx) => {
    const s = redact ? await requireMonitor(ctx.req) : await requireAdmin(ctx.req);
    const e = rowsOf((await exec([{ op: 'query', table: 'Evidence_Files', where: { evidence_id: ctx.params.id }, limit: 1 }]))[0])[0];
    if (!e) throw new HttpError(404, 'not_found', 'Evidence not found.');
    if (redact && e.kind === 'signature') throw new HttpError(403, 'withheld', 'Receiver signatures are visible to Main Admin only.');
    if (redact) await exec([log(ctx, staffActor(s), 'evidence_viewed', e.entity_type === 'found_item' ? 'FoundItem' : 'Handover', e.entity_id, e.evidence_id)]).catch(() => undefined);
    const res = await fileResponse(e.file_id);
    if (e.mime === 'application/pdf') res.headers.set('content-disposition', `inline; filename="${e.evidence_id}.pdf"`);
    return res;
  };

  // ------------------------------------------------------------ manual edits & corrections (all audited; identity never editable)
  const EDIT_FIELDS: [string, string][] = [['category', 'category'], ['itemName', 'item_name'], ['description', 'description'], ['colorFeatures', 'color_features'], ['lastSeenLocation', 'last_seen_location'], ['lostDate', 'lost_date'], ['lostTime', 'lost_time']];
  const PRE_VERIFICATION = ['Submitted', 'Under Review'];

  const myEdit: Handler = async (ctx) => {
    const s = await requireReporter(ctx.req);
    const body = await readJson<Record<string, unknown>>(ctx.req, 4_500_000);
    const input = parse(myComplaintEditInput, body);
    const { c } = await loadOwn(s, ctx.params.id);
    if (!PRE_VERIFICATION.includes(normalizeStatus(c.status))) throw new HttpError(409, 'locked', 'Details can only be edited before the office starts verification. Add information instead.');
    const after: Record<string, string> = Object.fromEntries(EDIT_FIELDS.map(([k, col]) => [col, String((input as Record<string, unknown>)[k] ?? '')]));
    after.ownership_evidence = input.ownershipEvidence;
    const changes = diff(c, after);
    let photo = '';
    if (body.photo) { photo = await uploadImage(body.photo, `complaint-${c.complaint_id}-r`); changes.push('photo replaced'); }
    if (!changes.length) throw new HttpError(422, 'validation_failed', 'Nothing changed.');
    const actor = reporterActor(s);
    const patch: Row = { ...after, updated_at: iso(), ...(photo ? { photo_file_id: photo } : {}) };
    mustOk(await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch, expectVersion: c.version },
      update(c.complaint_id, 'reporter_update', `You edited: ${changes.map((x) => x.split(':')[0]).join(', ')}`, actor.id),
      log(ctx, actor, 'complaint_edited_by_reporter', 'Complaint', c.complaint_id, changes.join('; ').replace(/ownership_evidence: "[^"]*" → "[^"]*"/, 'ownership_evidence: (private) changed')),
    ]), 3, 'complaint');
    return json({ ok: true, changed: changes.length });
  };

  const staffCreateComplaint: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(staffComplaintCreateInput, await readJson(ctx.req));
    const t = iso();
    const cid = newComplaintId();
    const r = await exec([
      {
        op: 'append', table: 'Complaints',
        row: {
          complaint_id: cid, created_at: t, updated_at: t, status: 'Submitted', idempotency_key: crypto.randomUUID(),
          name: input.reporterName, student_id: input.studentId, department: '', phone: input.reporterContact, email: '',
          category: input.category, item_name: input.itemName, description: input.description, color_features: input.colorFeatures,
          last_seen_location: input.lastSeenLocation, lost_date: input.lostDate, lost_time: input.lostTime,
          photo_file_id: '', ownership_evidence: input.ownershipEvidence, extra_info: '', linked_item_id: '',
          collection_instructions: '', staff_notes: `[${t.slice(0, 10)} ${s.email}] Entered by staff: ${input.reason}`, retention_until: '', version: '1',
          // Not a verified identity: receiver-confirmed handover needs the owner to report through the portal.
          reporter_uid: '', reporter_type: 'Staff-entered', verified_phone: '', submission_channel: 'staff',
          visit_info: '', proxy_name: '', proxy_phone: '', proxy_authorized_at: '', duplicate_of: '',
        },
      },
      update(cid, 'status', 'Complaint entered by the office', s.email, { data: { status: 'Submitted' } }),
      log(ctx, staffActor(s), 'complaint_created_by_staff', 'Complaint', cid, `unverified reporter "${input.reporterName}"; reason: ${input.reason}`),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true, complaintId: cid }, 201);
  };

  const staffEditComplaint: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(staffComplaintEditInput, await readJson(ctx.req));
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: ctx.params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    if (['Returned', 'Closed'].includes(normalizeStatus(c.status))) throw new HttpError(409, 'locked', 'Completed complaints cannot be edited. Add a note to record a correction.');
    const after: Record<string, string> = Object.fromEntries(EDIT_FIELDS.map(([k, col]) => [col, String((input as Record<string, unknown>)[k] ?? '')]));
    const changes = diff(c, after);
    if (!changes.length) throw new HttpError(422, 'validation_failed', 'Nothing changed.');
    mustOk(await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { ...after, updated_at: iso() }, expectVersion: c.version },
      update(c.complaint_id, 'staff_edit', `The office corrected: ${changes.map((x) => x.split(':')[0]).join(', ')}`, s.email),
      log(ctx, staffActor(s), 'complaint_edited', 'Complaint', c.complaint_id, `${changes.join('; ')} | reason: ${input.reason}`),
    ]), 3, 'complaint');
    return json({ ok: true, changed: changes.length });
  };

  const editFound: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(foundItemEditInput, await readJson(ctx.req));
    const f = rowOf((await exec([{ op: 'get', table: 'Found_Items', value: ctx.params.id }]))[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    if (f.status === 'Returned') throw new HttpError(409, 'locked', 'Returned items cannot be edited.');
    const after: Record<string, string> = {
      category: input.category, item_name: input.itemName, public_description: input.publicDescription, private_details: input.privateDetails,
      color_features: input.colorFeatures, found_location: input.foundLocation, found_date: input.foundDate, found_time: input.foundTime, storage_location: input.storageLocation,
    };
    const changes = diff(f, after);
    if (!changes.length) throw new HttpError(422, 'validation_failed', 'Nothing changed.');
    mustOk(await exec([
      { op: 'update', table: 'Found_Items', value: f.item_id, patch: { ...after, updated_at: iso() }, expectVersion: f.version },
      log(ctx, staffActor(s), 'found_item_edited', 'FoundItem', f.item_id, `${changes.map((x) => (x.startsWith('private_details') ? 'private_details changed' : x)).join('; ')} | reason: ${input.reason}`),
    ]), 2, 'found item');
    return json({ ok: true, changed: changes.length });
  };

  const archiveEvidence: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(archiveInput, await readJson(ctx.req));
    const e = (await (async () => {
      const row = rowsOf((await exec([{ op: 'query', table: 'Evidence_Files', where: { evidence_id: ctx.params.id }, limit: 1 }]))[0])[0];
      return row ? (await evidenceFor(row.entity_type, row.entity_id, true)).find((x) => x.evidence_id === row.evidence_id) : undefined;
    })());
    if (!e) throw new HttpError(404, 'not_found', 'Evidence not found.');
    if (e.archived_reason) throw new HttpError(409, 'already_archived', 'Already archived.');
    if (e.kind === 'signature') throw new HttpError(409, 'locked', 'Receiver signatures cannot be archived.');
    const ops: Op[] = [];
    if (e.entity_type === 'handover') {
      const h = await loadHandover(e.entity_id);
      if (!['Pending Acknowledgment', 'Acknowledged', 'Delivered'].includes(h.status)) throw new HttpError(409, 'evidence_locked', 'Evidence of a completed or cancelled handover cannot be changed.');
    } else {
      const f = rowOf((await exec([{ op: 'get', table: 'Found_Items', value: e.entity_id }]))[0]);
      if (f) ops.push({ op: 'update', table: 'Found_Items', value: f.item_id, patch: { photo_file_ids: f.photo_file_ids.split(',').filter((x) => x && x !== e.file_id).join(','), updated_at: iso() } });
    }
    ops.unshift({ op: 'append', table: 'Evidence_Archive', row: { archive_id: newId('AR'), created_at: iso(), evidence_id: e.evidence_id, entity_type: e.entity_type, entity_id: e.entity_id, archived_by: s.email, reason: input.reason } });
    ops.push(log(ctx, staffActor(s), 'evidence_archived', e.entity_type === 'found_item' ? 'FoundItem' : 'Handover', e.entity_id, `${e.evidence_id} (${e.kind}); file kept; reason: ${input.reason}`));
    mustOk(await exec(ops), ops.length, 'evidence');
    return json({ ok: true });
  };

  const claimNote: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(claimNoteInput, await readJson(ctx.req));
    const cl = rowOf((await exec([{ op: 'get', table: 'Claim_Requests', value: ctx.params.id }]))[0]);
    if (!cl) throw new HttpError(404, 'not_found', 'Claim not found.');
    // Original decision notes are kept; corrections are appended with author and date.
    const notes = [cl.decision_notes, `[Correction ${iso().slice(0, 16).replace('T', ' ')} ${s.email}] ${input.note}`].filter(Boolean).join('\n').slice(0, 3000);
    mustOk(await exec([
      { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { decision_notes: notes }, expectVersion: cl.version },
      log(ctx, staffActor(s), 'claim_note_added', 'Claim', cl.claim_id, input.note),
    ]), 2, 'claim');
    return json({ ok: true });
  };

  const correctHandover: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(handoverCorrectionInput, await readJson(ctx.req));
    const h = await loadHandover(ctx.params.id);
    const fields: Record<string, string> = {};
    if (input.receiverName) fields.receiver_name = input.receiverName;
    if (input.receiverIdType) fields.receiver_id_type = input.receiverIdType;
    if (input.receiverIdLast4) fields.receiver_id_last4 = input.receiverIdLast4.toUpperCase();
    const changes = diff(h, fields);
    // Once the receiver has confirmed, the identity they confirmed is bound to the record: only notes can be added.
    if (changes.length && h.status !== 'Pending Acknowledgment') throw new HttpError(409, 'locked', 'Receiver details are locked after the receiver confirms. Add a correction note instead.');
    if (!changes.length && !input.note) throw new HttpError(422, 'validation_failed', 'Nothing to correct.');
    const patch: Row = { ...fields };
    if (input.note) patch.notes = [h.notes, `[Correction ${iso().slice(0, 16).replace('T', ' ')} ${s.email}] ${input.note}`].filter(Boolean).join('\n').slice(0, 1000);
    mustOk(await exec([
      { op: 'update', table: 'Handover_Records', value: h.handover_id, patch, expectVersion: h.version },
      log(ctx, staffActor(s), 'handover_corrected', 'Handover', h.handover_id, `${[...changes, input.note && `note: ${input.note}`].filter(Boolean).join('; ')} | reason: ${input.reason}`),
    ]), 2, 'handover');
    return json({ ok: true });
  };

  // ------------------------------------------------------------ admin: other
  const unclaimed: Handler = async ({ req }) => {
    await requireAdmin(req);
    const settings = await getSettings();
    const days = Math.max(1, parseInt(settings.unclaimed_days || '60', 10) || 60);
    const cutoff = new Date(now() - days * 86400e3).toISOString().slice(0, 10);
    const r = await exec([{ op: 'query', table: 'Found_Items', where: { status: 'In Storage' }, limit: 5000, order: 'asc' }]);
    const rows = rowsOf(r[0]).filter((f) => f.found_date && f.found_date <= cutoff);
    return json({ ok: true, rows: rows.slice(0, 200), total: rows.length, days });
  };

  const activity: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const pg = page(url, 50);
    const entity = url.searchParams.get('entity') ?? '';
    const r = await exec([{ op: 'query', table: 'Activity_Log', where: entity ? { entity } : {}, offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const getSettingsRoute: Handler = async ({ req }) => {
    await requireAdmin(req);
    settingsCache = null;
    return json({ ok: true, settings: await getSettings(), editable: true, staffDomain: env.STAFF_DOMAIN ?? '', dataEnv: env.DATA_ENV ?? 'staging' });
  };

  const saveSettings: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ settings?: Record<string, unknown> }>(ctx.req);
    const incoming = body?.settings ?? {};
    const existing = rowsOf((await exec([{ op: 'query', table: 'Application_Settings', limit: 200 }]))[0]);
    const ops: Op[] = [];
    const t = iso();
    for (const key of EDITABLE_SETTINGS) {
      if (!(key in incoming)) continue;
      const value = String(incoming[key] ?? '').trim().slice(0, 300);
      if ((key === 'unclaimed_days' || key === 'retention_days') && !/^\d{1,4}$/.test(value)) throw new HttpError(422, 'validation_failed', `${key} must be a number of days.`, { [key]: 'Number of days' });
      if (['require_two_staff', 'submissions_open', 'guest_reports_open', 'home_delivery_enabled', 'handover_proof_required'].includes(key) && !['true', 'false'].includes(value)) throw new HttpError(422, 'validation_failed', `${key} must be true or false.`);
      if (existing.some((r) => r.key === key)) ops.push({ op: 'update', table: 'Application_Settings', value: key, patch: { value, updated_at: t, updated_by: s.email } });
      else ops.push({ op: 'append', table: 'Application_Settings', row: { key, value, updated_at: t, updated_by: s.email } });
    }
    if (!ops.length) throw new HttpError(422, 'validation_failed', 'No settings changed.');
    ops.push(log(ctx, staffActor(s), 'settings_updated', 'Settings', 'app', Object.keys(incoming).join(',')));
    mustOk(await exec(ops), ops.length, 'settings');
    settingsCache = null;
    return json({ ok: true });
  };

  const backup: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const b = await store().backup();
    await exec([log(ctx, staffActor(s), 'backup_created', 'Settings', b.backupId, b.name)]);
    return json({ ok: true, ...b });
  };

  const staffFile: Handler = async ({ req, params }) => {
    await requireAdmin(req);
    return fileResponse(params.id.replace('~', '/'));
  };

  // ------------------------------------------------------------ admin: identities & permissions
  const listRegistry: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const q = (url.searchParams.get('q') ?? '').trim();
    const pg = page(url, 50);
    const where: Record<string, string> = {};
    if (q.startsWith('+') || /^\d{10}$/.test(q)) where.phone = q.startsWith('+') ? q : `+91${q}`;
    else if (q) where.student_id = q.toUpperCase();
    const r = await exec([{ op: 'query', table: 'Student_Registry', where, offset: pg.offset, limit: pg.limit, order: 'asc' }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const importRegistry: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ rows?: unknown[]; source?: string }>(ctx.req, 1_000_000);
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const source = String(body?.source ?? '').trim().slice(0, 200);
    if (!raw.length || raw.length > 500) throw new HttpError(422, 'validation_failed', 'Send between 1 and 500 rows per import.');
    if (source.length < 5) throw new HttpError(422, 'validation_failed', 'Describe the authorised source of this registry data.', { source: 'Required' });
    const existing = rowsOf((await exec([{ op: 'query', table: 'Student_Registry', limit: 5000, order: 'asc' }]))[0]);
    const bySid = new Map(existing.map((r) => [r.student_id, r]));
    const phoneOwner = new Map(existing.filter((r) => r.status === 'active').map((r) => [r.phone, r.student_id]));
    const errors: { row: number; error: string }[] = [];
    const ops: Op[] = [];
    let added = 0, updated = 0, unchanged = 0;
    const t = iso();
    raw.forEach((item, i) => {
      const p = registryRowInput.safeParse(item);
      if (!p.success) { errors.push({ row: i + 1, error: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }); return; }
      const v = p.data;
      const owner = phoneOwner.get(v.phone);
      if (v.status === 'active' && owner && owner !== v.studentId) { errors.push({ row: i + 1, error: `phone already registered to ${owner}` }); return; }
      const prev = bySid.get(v.studentId);
      if (prev) {
        const patch: Row = {};
        for (const [k, col] of [['name', 'name'], ['department', 'department'], ['year', 'year'], ['phone', 'phone'], ['email', 'email'], ['status', 'status']] as const) if (String(v[k] ?? '') !== prev[col]) patch[col] = String(v[k] ?? '');
        if (!Object.keys(patch).length) { unchanged++; return; }
        if (patch.phone || patch.status) patch.sessions_valid_after = t;
        ops.push({ op: 'update', table: 'Student_Registry', value: v.studentId, patch: { ...patch, updated_at: t, updated_by: s.email } });
        updated++;
      } else {
        ops.push({ op: 'append', table: 'Student_Registry', row: { student_id: v.studentId, name: v.name, department: v.department, year: v.year, phone: v.phone, email: v.email, status: v.status, sessions_valid_after: '', updated_at: t, updated_by: s.email, notes: `import: ${source}`, version: '1' } });
        bySid.set(v.studentId, { student_id: v.studentId } as Row);
        added++;
      }
      if (v.status === 'active') phoneOwner.set(v.phone, v.studentId);
    });
    for (let i = 0; i < ops.length; i += 24) mustOk(await exec(ops.slice(i, i + 24)), Math.min(24, ops.length - i), 'registry');
    await exec([log(ctx, staffActor(s), 'registry_imported', 'Registry', 'bulk', `+${added} ~${updated} =${unchanged} !${errors.length}; source: ${source}`)]);
    return json({ ok: true, added, updated, unchanged, errors: errors.slice(0, 100) });
  };

  const updateRegistry: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ phone?: string; status?: string; note?: string }>(ctx.req);
    const note = String(body?.note ?? '').trim().slice(0, 300);
    if (note.length < 10) throw new HttpError(422, 'validation_failed', 'Record how the student’s identity was verified (e.g. college ID checked in person).', { note: 'At least 10 characters' });
    const r = rowOf((await exec([{ op: 'get', table: 'Student_Registry', value: ctx.params.id }]))[0]);
    if (!r) throw new HttpError(404, 'not_found', 'Student not found.');
    const patch: Row = { updated_at: iso(), updated_by: s.email, sessions_valid_after: iso(), notes: [r.notes, `[${iso().slice(0, 10)} ${s.email}] ${note}`].filter(Boolean).join('\n').slice(-1500) };
    const changes: string[] = [];
    if (body?.phone) {
      const v = registryRowInput.shape.phone.safeParse(body.phone);
      if (!v.success) throw new HttpError(422, 'validation_failed', 'Invalid mobile number.', { phone: 'Invalid' });
      const clash = rowsOf((await exec([{ op: 'query', table: 'Student_Registry', where: { phone: v.data, status: 'active' }, limit: 2 }]))[0]).find((x) => x.student_id !== r.student_id);
      if (clash) throw new HttpError(409, 'phone_in_use', `That number is registered to ${clash.student_id}.`);
      patch.phone = v.data;
      changes.push(`phone ${maskPhone(r.phone)} -> ${maskPhone(v.data)}`);
    }
    if (body?.status) {
      if (!['active', 'inactive'].includes(body.status)) throw new HttpError(422, 'validation_failed', 'Invalid status.');
      patch.status = body.status;
      changes.push(`status ${r.status} -> ${body.status}`);
    }
    if (!changes.length) changes.push('sessions revoked');
    mustOk(await exec([
      { op: 'update', table: 'Student_Registry', value: r.student_id, patch, expectVersion: r.version },
      log(ctx, staffActor(s), 'registry_identity_updated', 'Registry', r.student_id, `${changes.join('; ')}; verified: ${note}`),
    ]), 2, 'registry');
    return json({ ok: true });
  };

  const listGuests: Handler = async ({ req, url }) => {
    await requireAdmin(req);
    const pg = page(url, 50);
    const r = await exec([{ op: 'query', table: 'Guest_Identities', offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const setGuestStatus: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ status?: string; note?: string }>(ctx.req);
    const status = body?.status === 'blocked' ? 'blocked' : body?.status === 'active' ? 'active' : null;
    const note = String(body?.note ?? '').trim().slice(0, 300);
    if (!status || note.length < 5) throw new HttpError(422, 'validation_failed', 'Choose a status and give a reason.');
    const g = rowOf((await exec([{ op: 'get', table: 'Guest_Identities', value: ctx.params.id }]))[0]);
    if (!g) throw new HttpError(404, 'not_found', 'Guest not found.');
    mustOk(await exec([
      { op: 'update', table: 'Guest_Identities', value: g.uid, patch: { status }, expectVersion: g.version },
      log(ctx, staffActor(s), 'guest_status_changed', 'Guest', g.uid, `${g.status} -> ${status}: ${note}`),
    ]), 2, 'guest');
    return json({ ok: true });
  };

  const listRoles: Handler = async ({ req }) => {
    await requireAdmin(req);
    const rows = rowsOf((await exec([{ op: 'query', table: 'Staff_Roles', limit: 1000, order: 'asc' }]))[0]);
    return json({ ok: true, rows, bootstrapAdmins: [...bootstrapAdmins] });
  };

  const saveRole: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const input = parse(staffRoleInput, await readJson(ctx.req));
    if (env.STAFF_DOMAIN && !input.email.endsWith(`@${env.STAFF_DOMAIN}`)) throw new HttpError(422, 'validation_failed', `Staff must use @${env.STAFF_DOMAIN} accounts.`, { email: 'Wrong domain' });
    if (input.email === s.email) throw new HttpError(409, 'self_change', 'You cannot change your own role.');
    const prev = rowOf((await exec([{ op: 'get', table: 'Staff_Roles', value: input.email }]))[0]);
    const t = iso();
    const op: Op = prev
      ? { op: 'update', table: 'Staff_Roles', value: input.email, patch: { role: input.role, name: input.name || prev.name, status: input.status, updated_at: t }, expectVersion: prev.version }
      : { op: 'append', table: 'Staff_Roles', row: { email: input.email, role: input.role, name: input.name, status: input.status, added_at: t, added_by: s.email, updated_at: t, version: '1' } };
    mustOk(await exec([op, log(ctx, staffActor(s), 'staff_role_saved', 'Staff', input.email, prev ? `${prev.role}/${prev.status} -> ${input.role}/${input.status}` : `added as ${input.role}`)]), 2, 'staff role');
    rolesCache = null;
    return json({ ok: true });
  };

  const schemaStatus: Handler = async ({ req }) => {
    await requireAdmin(req);
    if (!store().schemaPlan) return json({ ok: true, plan: [] });
    return json({ ok: true, plan: await store().schemaPlan!(), dataEnv: env.DATA_ENV ?? 'staging' });
  };

  const schemaMigrate: Handler = async (ctx) => {
    const s = await requireAdmin(ctx.req);
    const body = await readJson<{ confirm?: string }>(ctx.req);
    if (body?.confirm !== 'MIGRATE') throw new HttpError(422, 'validation_failed', 'Type MIGRATE to confirm.');
    if (!store().migrate) return json({ ok: true, applied: [] });
    const result = await store().migrate!();
    await exec([log(ctx, staffActor(s), 'schema_migrated', 'Settings', 'schema', `${result.applied.join('; ')}; backup ${result.backupId}`)]);
    rolesCache = null;
    return json({ ok: true, ...result });
  };

  // ------------------------------------------------------------ monitoring (management + admin, read-only)
  function inRange(url: URL) {
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const f = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '';
    const t = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to + 'T23:59:59.999Z' : '';
    return { from: f, to: t, test: (s: string) => (!f || s >= f) && (!t || s <= t) };
  }

  async function analyticsData(url: URL) {
    const range = inRange(url);
    const r = await exec([
      { op: 'query', table: 'Complaints', columns: ['complaint_id', 'created_at', 'updated_at', 'status', 'category', 'department', 'last_seen_location', 'reporter_type'], limit: 5000 },
      { op: 'query', table: 'Found_Items', columns: ['created_at', 'status', 'category', 'found_location'], limit: 5000 },
      { op: 'query', table: 'Handover_Records', columns: ['created_at', 'complaint_id', 'status', 'released_at', 'receiver_type'], limit: 5000 },
      { op: 'query', table: 'Claim_Requests', columns: ['created_at', 'status'], limit: 5000 },
    ]);
    const complaints = rowsOf(r[0]).filter((c) => range.test(c.created_at)).map((c) => ({ ...c, status: normalizeStatus(c.status) }) as Row);
    const allComplaints = new Map(rowsOf(r[0]).map((c) => [c.complaint_id, c.created_at]));
    const items = rowsOf(r[1]).filter((f) => range.test(f.created_at));
    const handovers = rowsOf(r[2]).map((h) => ({ ...h, status: h.status || 'Released', released_at: h.released_at || (h.status ? '' : h.created_at) }) as Row);
    const released = handovers.filter((h) => h.status === 'Released' && range.test(h.released_at));
    const claims = rowsOf(r[3]).filter((c) => range.test(c.created_at));
    const count = <T,>(rows: T[], key: (r: T) => string) => { const o: Record<string, number> = {}; for (const x of rows) { const k = key(x) || 'Unspecified'; o[k] = (o[k] ?? 0) + 1; } return o; };
    const place = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ,-]/gu, '').slice(0, 48);
    const byDepartment: Record<string, { complaints: number; returned: number }> = {};
    for (const c of complaints) { const d = (byDepartment[c.department || (c.reporter_type === 'Guest' ? 'Guests' : 'Unspecified')] ??= { complaints: 0, returned: 0 }); d.complaints++; if (c.status === 'Returned' || c.status === 'Closed') d.returned++; }
    const lostPlaces = count(complaints, (c) => place(c.last_seen_location));
    const foundPlaces = count(items, (f) => place(f.found_location));
    const hotspots = Object.keys({ ...lostPlaces, ...foundPlaces }).map((k) => ({ location: k, lost: lostPlaces[k] ?? 0, found: foundPlaces[k] ?? 0 })).sort((a, b) => b.lost + b.found - (a.lost + a.found)).slice(0, 20);
    const durations = released.map((h) => (Date.parse(h.released_at) - Date.parse(allComplaints.get(h.complaint_id) ?? h.released_at)) / 86400e3).filter((d) => d >= 0);
    const end = range.to ? Date.parse(range.to) : now();
    const weeks: { week: string; complaints: number; found: number; returned: number }[] = [];
    for (let w = 11; w >= 0; w--) {
      const s0 = end - (w + 1) * 7 * 86400e3, e0 = end - w * 7 * 86400e3;
      const inW = (s: string) => { const t = Date.parse(s); return t >= s0 && t < e0; };
      weeks.push({ week: new Date(s0).toISOString().slice(0, 10), complaints: complaints.filter((c) => inW(c.created_at)).length, found: items.filter((f) => inW(f.created_at)).length, returned: released.filter((h) => inW(h.released_at)).length });
    }
    const returnedCount = released.filter((h) => allComplaints.has(h.complaint_id)).length;
    return {
      range: { from: range.from, to: range.to.slice(0, 10) },
      totals: {
        complaints: complaints.length,
        pending: complaints.filter((c) => OPEN_STATUSES.includes(c.status as ComplaintStatus)).length,
        foundItems: items.length,
        returned: returnedCount,
        handoversPending: handovers.filter((h) => h.status === 'Pending Acknowledgment' || h.status === 'Acknowledged').length,
        disputes: complaints.filter((c) => c.status === 'Disputed').length + claims.filter((c) => c.status === 'Disputed').length,
      },
      recoveryRate: complaints.length ? Math.round((returnedCount / complaints.length) * 1000) / 10 : 0,
      avgDaysToReturn: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      byStatus: count(complaints, (c) => c.status),
      byCategory: count(complaints, (c) => c.category),
      byDepartment,
      reporterTypes: count(complaints, (c) => c.reporter_type || 'Legacy'),
      hotspots,
      handoverActivity: { released: released.length, proxy: released.filter((h) => h.receiver_type === 'proxy').length, cancelled: handovers.filter((h) => h.status === 'Cancelled' || h.status === 'Expired').length },
      itemsByStatus: count(items, (f) => f.status),
      weeks,
    };
  }

  const mgmtAnalytics: Handler = async ({ req, url }) => {
    await requireMonitor(req);
    return json({ ok: true, ...(await analyticsData(url)) });
  };

  const mgmtComplaints: Handler = async ({ req, url }) => {
    await requireMonitor(req);
    const pg = page(url, 25);
    const where: Record<string, string> = {};
    const status = url.searchParams.get('status') ?? '';
    const type = url.searchParams.get('type') ?? '';
    if (status) where.status = status;
    if (type) where.reporter_type = type;
    const r = await exec([{ op: 'query', table: 'Complaints', where, offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]).map(mgmtView), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const mgmtComplaint: Handler = async ({ req, params }) => {
    await requireMonitor(req);
    const r = await exec([
      { op: 'get', table: 'Complaints', value: params.id },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: params.id, type: 'status' }, limit: 100, order: 'asc' },
      { op: 'query', table: 'Handover_Records', where: { complaint_id: params.id }, limit: 20 },
    ]);
    const c = rowOf(r[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    return json({
      ok: true,
      complaint: mgmtView(c),
      timeline: rowsOf(r[1]).map((u) => ({ status: normalizeStatus(String(safeJson(u.data_json).status ?? '')), at: u.created_at, actor: u.actor.startsWith('guest:') || u.actor.startsWith('student:') ? 'Reporter' : u.actor })),
      handovers: rowsOf(r[2]).map((h) => { const v = handoverView(h, true); return { ...v, approvedBy: h.approved_by, releasedBy: h.handed_over_by }; }),
    });
  };

  const mgmtFound: Handler = async ({ req, url }) => {
    await requireMonitor(req);
    const pg = page(url, 24);
    const status = url.searchParams.get('status') ?? '';
    const r = await exec([{ op: 'query', table: 'Found_Items', where: status ? { status } : {}, offset: pg.offset, limit: pg.limit }]);
    return json({ ok: true, rows: rowsOf(r[0]).map(publicItem), total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const mgmtHandovers: Handler = async ({ req, url }) => {
    await requireMonitor(req);
    const status = url.searchParams.get('status') ?? '';
    const r = await exec([{ op: 'query', table: 'Handover_Records', limit: 200 }]);
    const rows = rowsOf(r[0]).map((h) => { const v = handoverView(h, true); return { ...v, approvedBy: h.approved_by, startedBy: h.started_by, releasedBy: h.handed_over_by, deliveryStaff: h.delivery_staff, deliveredBy: h.delivered_by }; }).filter((h) => !status || h.status === status);
    return json({ ok: true, rows });
  };

  const SENSITIVE_ACTIONS = new Set(['registry_identity_updated', 'registry_imported', 'guest_status_changed', 'proxy_authorized', 'handover_started', 'student_login_denied', 'student_login_ambiguous']);
  const mgmtAudit: Handler = async ({ req, url }) => {
    await requireMonitor(req);
    const pg = page(url, 50);
    const entity = url.searchParams.get('entity') ?? '';
    const r = await exec([{ op: 'query', table: 'Activity_Log', where: entity ? { entity } : {}, offset: pg.offset, limit: pg.limit }]);
    const rows = rowsOf(r[0])
      .filter((x) => !['student_login', 'guest_login'].includes(x.action))
      .map((x) => ({ log_id: x.log_id, created_at: x.created_at, actor: x.actor.startsWith('guest:') ? 'guest' : x.actor, role: x.role, action: x.action, entity: x.entity, entity_id: x.entity === 'Auth' ? '' : x.entity_id, details: SENSITIVE_ACTIONS.has(x.action) ? '[restricted]' : x.details.replace(/\+?\d[\d\s-]{8,}\d/g, '[phone]') }));
    return json({ ok: true, rows, total: totalOf(r[0]), page: pg.page, pageSize: pg.limit });
  };

  const mgmtExport: Handler = async (ctx) => {
    const s = await requireMonitor(ctx.req);
    const type = ctx.url.searchParams.get('type') ?? 'complaints';
    const range = inRange(ctx.url);
    let header: string[];
    let rows: string[][];
    if (type === 'complaints') {
      const all = rowsOf((await exec([{ op: 'query', table: 'Complaints', limit: 5000, order: 'asc' }]))[0]).filter((c) => range.test(c.created_at)).map(mgmtView);
      header = ['complaint_id', 'created_at', 'updated_at', 'status', 'reporter_type', 'name', 'student_id', 'department', 'category', 'item_name', 'last_seen_location', 'lost_date'];
      rows = all.map((c) => header.map((h) => String((c as Record<string, string>)[h] ?? '')));
    } else if (type === 'handovers') {
      const all = rowsOf((await exec([{ op: 'query', table: 'Handover_Records', limit: 5000, order: 'asc' }]))[0]).filter((h) => range.test(h.created_at));
      header = ['handover_id', 'complaint_id', 'item_id', 'status', 'receiver_name', 'receiver_type', 'verification_method', 'approved_by', 'released_by', 'acknowledged_at', 'released_at'];
      rows = all.map((h) => [h.handover_id, h.complaint_id, h.item_id, h.status || 'Released', h.receiver_name, h.receiver_type || 'owner', h.verification_method, h.approved_by, h.handed_over_by, h.acknowledged_at, h.released_at || (h.status ? '' : h.created_at)]);
    } else if (type === 'found') {
      const all = rowsOf((await exec([{ op: 'query', table: 'Found_Items', limit: 5000, order: 'asc' }]))[0]).filter((f) => range.test(f.created_at)).map(publicItem);
      header = ['itemId', 'createdAt', 'status', 'category', 'itemName', 'foundLocation', 'foundDate', 'registeredBy'];
      rows = all.map((f) => header.map((h) => String((f as Record<string, string>)[h] ?? '')));
    } else throw new HttpError(422, 'validation_failed', 'Unknown export type.');
    const cell = (v: string) => { const x = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    await exec([log(ctx, staffActor(s), 'report_exported', 'Report', type, `${rows.length} rows ${range.from || '…'} to ${range.to.slice(0, 10) || '…'}`)]);
    return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="findback-${type}-${iso().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
  };

  // ------------------------------------------------------------ router
  const CID = '(?<id>FB-[0-9A-Z]{4}-[0-9A-Z]{4})';
  const R = (s: string) => new RegExp(`^${s.replace(':cid', CID).replace(':fi', '(?<id>FI-[0-9A-Z]{8})').replace(':cl', '(?<id>CL-[0-9A-Z]{8})').replace(':ho', '(?<id>HO-[0-9A-Z]{8})').replace(':ev', '(?<id>EV-[0-9A-Z]{8})')}$`);
  const routes: [string, RegExp, Handler][] = [
    ['GET', R('/api/health'), health],
    ['GET', R('/api/public/config'), publicConfig],
    // reporters (student / guest)
    ['POST', R('/api/auth/session'), reporterSession],
    ['GET', R('/api/me'), me],
    ['GET', R('/api/me/complaints'), myComplaints],
    ['POST', R('/api/me/complaints'), createComplaint],
    ['GET', R('/api/me/notifications'), myNotifications],
    ['GET', R('/api/me/complaints/:cid'), myComplaint],
    ['POST', R('/api/me/complaints/:cid/update'), myUpdate],
    ['POST', R('/api/me/complaints/:cid/edit'), myEdit],
    ['POST', R('/api/me/complaints/:cid/claim'), myClaim],
    ['POST', R('/api/me/complaints/:cid/cancel'), myCancel],
    ['POST', R('/api/me/complaints/:cid/proxy'), myProxy],
    ['GET', R('/api/me/complaints/:cid/photo'), myPhoto],
    ['GET', R('/api/me/handovers'), myPendingHandovers],
    ['POST', R('/api/me/handovers/:ho/acknowledge'), acknowledge],
    // staff sign-in
    ['POST', R('/api/staff/session'), staffSession],
    ['GET', R('/api/staff/me'), staffMe],
    // Main Admin (every handler calls requireAdmin)
    ['GET', R('/api/staff/dashboard'), dashboard],
    ['GET', R('/api/staff/complaints'), listComplaints],
    ['GET', R('/api/staff/complaints/:cid'), getComplaint],
    ['POST', R('/api/staff/complaints/:cid/status'), setStatus],
    ['POST', R('/api/staff/complaints/:cid/note'), addNote],
    ['POST', R('/api/staff/complaints/:cid/propose-match'), proposeMatch],
    ['POST', R('/api/staff/complaints/:cid/withdraw-match'), withdrawMatch],
    ['GET', R('/api/staff/found-items'), listFound],
    ['POST', R('/api/staff/found-items'), createFound],
    ['GET', R('/api/staff/found-items/:fi'), getFound],
    ['POST', R('/api/staff/found-items/:fi/status'), setFoundStatus],
    ['POST', R('/api/staff/found-items/:fi/evidence'), foundEvidenceUpload],
    ['POST', R('/api/staff/found-items/:fi/edit'), editFound],
    ['POST', R('/api/staff/complaints'), staffCreateComplaint],
    ['POST', R('/api/staff/complaints/:cid/edit'), staffEditComplaint],
    ['POST', R('/api/staff/evidence/:ev/archive'), archiveEvidence],
    ['POST', R('/api/staff/claims/:cl/notes'), claimNote],
    ['POST', R('/api/staff/handovers/:ho/correct'), correctHandover],
    ['GET', R('/api/staff/claims'), listClaims],
    ['POST', R('/api/staff/claims/:cl/decision'), decideClaim],
    ['GET', R('/api/staff/handovers'), listHandovers],
    ['POST', R('/api/staff/handovers'), startHandover],
    ['GET', R('/api/staff/handovers/:ho'), getHandover],
    ['POST', R('/api/staff/handovers/:ho/release'), releaseHandover],
    ['POST', R('/api/staff/handovers/:ho/cancel'), cancelHandover],
    ['POST', R('/api/staff/handovers/:ho/evidence'), handoverEvidenceUpload],
    ['POST', R('/api/staff/handovers/:ho/delivery-code'), deliveryCode],
    ['POST', R('/api/staff/handovers/:ho/delivered'), markDelivered],
    ['GET', R('/api/staff/evidence'), listEvidence(false)],
    ['GET', R('/api/staff/evidence/:ev/file'), evidenceFile(false)],
    ['GET', R('/api/staff/unclaimed'), unclaimed],
    ['GET', R('/api/staff/activity'), activity],
    ['GET', R('/api/staff/settings'), getSettingsRoute],
    ['POST', R('/api/staff/settings'), saveSettings],
    ['POST', R('/api/staff/backup'), backup],
    ['GET', R('/api/staff/files/(?<id>[A-Za-z0-9_~-]{8,100})'), staffFile],
    ['GET', R('/api/staff/registry'), listRegistry],
    ['POST', R('/api/staff/registry/import'), importRegistry],
    ['POST', R('/api/staff/registry/(?<id>[A-Z0-9/_.-]{2,30})'), updateRegistry],
    ['GET', R('/api/staff/guests'), listGuests],
    ['POST', R('/api/staff/guests/(?<id>[A-Za-z0-9_.:-]{1,128})/status'), setGuestStatus],
    ['GET', R('/api/staff/roles'), listRoles],
    ['POST', R('/api/staff/roles'), saveRole],
    ['GET', R('/api/staff/schema'), schemaStatus],
    ['POST', R('/api/staff/schema/migrate'), schemaMigrate],
    // Management monitoring — GET only, by design
    ['GET', R('/api/mgmt/analytics'), mgmtAnalytics],
    ['GET', R('/api/mgmt/complaints'), mgmtComplaints],
    ['GET', R('/api/mgmt/complaints/:cid'), mgmtComplaint],
    ['GET', R('/api/mgmt/found-items'), mgmtFound],
    ['GET', R('/api/mgmt/handovers'), mgmtHandovers],
    ['GET', R('/api/mgmt/audit'), mgmtAudit],
    ['GET', R('/api/mgmt/evidence'), listEvidence(true)],
    ['GET', R('/api/mgmt/evidence/:ev/file'), evidenceFile(true)],
    ['GET', R('/api/mgmt/export'), mgmtExport],
  ];
  const PUBLIC_STAFF = new Set(['/api/staff/session', '/api/staff/me']);

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, allowedOrigins);
    const reqId = crypto.randomUUID().slice(0, 8);
    const started = now();
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && !allowedOrigins.includes(origin)) return withHeaders(errorResponse(new HttpError(403, 'origin_not_allowed', 'Origin not allowed')), cors);
    let res: Response;
    try {
      // On Cloud Run the Google front end appends the real client IP as the last X-Forwarded-For entry.
      const ip = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || req.headers.get('x-test-ip') || '0.0.0.0';
      await limit(limiters.api, `api:${ip}`);
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw new HttpError(404, 'not_found', 'Not found');
      // Defence in depth: every Main Admin route requires an admin session before the handler runs.
      if (url.pathname.startsWith('/api/staff/') && !PUBLIC_STAFF.has(url.pathname)) await requireAdmin(req);
      const params = (route[1].exec(url.pathname)?.groups ?? {}) as Record<string, string>;
      const ipHash = env.HASH_PEPPER ? (await sha256Hex(`${env.HASH_PEPPER}:ip:${ip}`)).slice(0, 16) : '';
      res = await route[2]({ req, url, ip, ipHash, params });
    } catch (e) {
      if (e instanceof HttpError) res = errorResponse(e);
      else if (e instanceof StoreError) {
        const map = {
          busy: [503, 'service_busy', 'The service is busy. Please retry in a few seconds.'],
          quota: [503, 'service_busy', 'The service is at capacity. Please retry in a minute.'],
          unavailable: [503, 'service_unavailable', 'The data service is temporarily unavailable. Nothing was saved unless confirmed.'],
          not_configured: [503, 'not_configured', 'The data service is not ready yet.'],
          rejected: [502, 'upstream_rejected', 'The data service rejected the request.'],
        } as const;
        const [status, code, msg] = map[e.code];
        console.error(JSON.stringify({ severity: 'ERROR', reqId, store: e.code, msg: e.message.slice(0, 200) }));
        res = json({ ok: false, error: code, message: msg }, status, { 'retry-after': '5' });
      } else {
        console.error(JSON.stringify({ severity: 'ERROR', reqId, path: url.pathname.replace(/(FB|FI|CL|HO)-[0-9A-Z-]+/g, '$1-*'), error: String((e as Error)?.message ?? e).slice(0, 200) }));
        res = json({ ok: false, error: 'internal', message: 'Unexpected error. Please retry.' }, 500);
      }
    }
    // Structured access log (Cloud Logging): never bodies, tokens, phone numbers or other personal data.
    console.log(JSON.stringify({ severity: res.status >= 500 ? 'ERROR' : 'INFO', reqId, m: req.method, p: url.pathname.replace(/(FB|FI|CL|HO)-[0-9A-Z-]+/g, '$1-*').replace(/registry\/.+/, 'registry/*').replace(/guests\/.+/, 'guests/*'), s: res.status, ms: now() - started }));
    return withHeaders(res, { ...cors, 'x-request-id': reqId });
  };
}
