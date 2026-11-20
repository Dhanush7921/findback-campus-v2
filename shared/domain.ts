import { z } from 'zod';

/** Main complaint lifecycle, in timeline order. */
export const MAIN_STATUSES = [
  'Submitted',
  'Under Review',
  'Potential Match',
  'Ownership Verification',
  'Ready for Collection',
  'Awaiting Receiver Confirmation',
  'Returned',
  'Closed',
] as const;
/** Side outcomes that can branch off the main lifecycle. */
export const SIDE_STATUSES = ['Rejected', 'Cancelled', 'Disputed', 'Unclaimed'] as const;
export const COMPLAINT_STATUSES = [...MAIN_STATUSES, ...SIDE_STATUSES] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const OPEN_STATUSES: ComplaintStatus[] = ['Submitted', 'Under Review', 'Potential Match', 'Ownership Verification', 'Ready for Collection', 'Awaiting Receiver Confirmation', 'Disputed', 'Unclaimed'];

/** V1 values that mean the same thing (read-time mapping; stored rows are never rewritten). */
const LEGACY_STATUS: Record<string, ComplaintStatus> = { 'Awaiting Verification': 'Ownership Verification' };
export function normalizeStatus(s: string): string {
  return LEGACY_STATUS[s] ?? s;
}

/** Server-enforced status transitions. */
export const STATUS_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  Submitted: ['Under Review', 'Potential Match', 'Rejected', 'Cancelled', 'Closed'],
  'Under Review': ['Potential Match', 'Rejected', 'Cancelled', 'Closed'],
  'Potential Match': ['Under Review', 'Ownership Verification', 'Rejected', 'Cancelled', 'Closed'],
  'Ownership Verification': ['Potential Match', 'Under Review', 'Ready for Collection', 'Disputed', 'Cancelled'],
  Disputed: ['Ownership Verification', 'Potential Match', 'Ready for Collection', 'Under Review', 'Rejected', 'Closed'],
  'Ready for Collection': ['Awaiting Receiver Confirmation', 'Under Review', 'Unclaimed', 'Cancelled'],
  'Awaiting Receiver Confirmation': ['Returned', 'Ready for Collection'],
  Returned: ['Closed'],
  Unclaimed: ['Ready for Collection', 'Closed'],
  Rejected: ['Closed'],
  Cancelled: [],
  Closed: [],
};
/** Statuses that only the claim / handover workflow may set. */
export const WORKFLOW_STATUSES: ComplaintStatus[] = ['Ownership Verification', 'Ready for Collection', 'Awaiting Receiver Confirmation', 'Returned'];

export const ROLES = ['admin', 'management'] as const;
export type StaffRole = (typeof ROLES)[number];
export type ReporterType = 'Student' | 'Guest' | 'Staff';

export const FOUND_ITEM_STATUSES = ['In Storage', 'Matched', 'Claimed', 'Returned', 'Donated', 'Disposed'] as const;
export type FoundItemStatus = (typeof FOUND_ITEM_STATUSES)[number];

export const CLAIM_STATUSES = ['Pending', 'Disputed', 'Approved', 'Rejected', 'Completed', 'Withdrawn'] as const;
export const HANDOVER_STATUSES = ['Pending Acknowledgment', 'Acknowledged', 'Released', 'Cancelled', 'Expired'] as const;

export const CATEGORIES = [
  'Electronics',
  'Mobile Phone',
  'Laptop / Tablet',
  'ID Card / Documents',
  'Wallet / Purse',
  'Keys',
  'Bag / Backpack',
  'Books / Stationery',
  'Clothing',
  'Jewellery / Watch',
  'Water Bottle / Lunch Box',
  'Sports Equipment',
  'Other',
] as const;

/**
 * Sheet schemas: the single source of truth for column order.
 * V2 only APPENDS columns to the V1 tabs (never reorders or renames), so V1 rows keep their meaning and the
 * V1 app (which checks only its own column prefix) keeps working against a migrated sheet.
 */
export const TABLES = {
  Complaints: [
    'complaint_id', 'created_at', 'updated_at', 'status', 'idempotency_key',
    'name', 'student_id', 'department', 'phone', 'email',
    'category', 'item_name', 'description', 'color_features', 'last_seen_location',
    'lost_date', 'lost_time', 'photo_file_id', 'ownership_evidence', 'extra_info',
    'linked_item_id', 'collection_instructions', 'staff_notes', 'retention_until', 'version',
    // V2
    'reporter_uid', 'reporter_type', 'verified_phone', 'submission_channel', 'visit_info',
    'proxy_name', 'proxy_phone', 'proxy_authorized_at', 'duplicate_of',
  ],
  Access_Credentials: [
    'complaint_id', 'pin_hash', 'created_at', 'failed_attempts', 'locked_until',
    'last_success_at', 'rotated_at', 'version',
  ],
  Found_Items: [
    'item_id', 'created_at', 'updated_at', 'status', 'category', 'item_name',
    'public_description', 'private_details', 'color_features', 'found_location', 'found_date',
    'storage_location', 'photo_file_ids', 'registered_by', 'matched_complaint_id', 'version',
    // V2
    'found_time',
  ],
  Claim_Requests: [
    'claim_id', 'created_at', 'complaint_id', 'item_id', 'evidence', 'status',
    'reviewed_by', 'reviewed_at', 'decision_notes', 'checks_json', 'version',
    // V2
    'claimant_uid', 'evidence_file_id',
  ],
  Complaint_Updates: [
    'update_id', 'created_at', 'complaint_id', 'type', 'message', 'item_id',
    'data_json', 'visible_to_student', 'actor',
  ],
  Handover_Records: [
    'handover_id', 'created_at', 'complaint_id', 'item_id', 'claim_id',
    'receiver_name', 'receiver_id_checked', 'approved_by', 'handed_over_by', 'notes',
    // V2 (empty status = V1 record, released at created_at)
    'status', 'started_by', 'reporter_uid', 'receiver_type', 'owner_authorization', 'receiver_uid', 'receiver_phone',
    'receiver_id_type', 'receiver_id_last4', 'verification_method', 'challenge_hash', 'challenge_expires_at',
    'challenge_attempts', 'acknowledged_at', 'signature_name', 'acknowledgment_text', 'evidence_file_id',
    'released_at', 'version',
  ],
  Activity_Log: ['log_id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'details', 'role', 'ip_hash'],
  Application_Settings: ['key', 'value', 'updated_at', 'updated_by'],
  // V2 tabs (private identity data; only the API service account may read them)
  Student_Registry: [
    'student_id', 'name', 'department', 'year', 'phone', 'email', 'status',
    'sessions_valid_after', 'updated_at', 'updated_by', 'notes', 'version',
  ],
  Guest_Identities: ['uid', 'phone', 'name', 'created_at', 'last_login_at', 'status', 'version'],
  Staff_Roles: ['email', 'role', 'name', 'status', 'added_at', 'added_by', 'updated_at', 'version'],
} as const;
export type TableName = keyof typeof TABLES;
export type Row = Record<string, string>;
/** Tables that the application may only append to. */
export const APPEND_ONLY: TableName[] = ['Activity_Log', 'Complaint_Updates'];

/** Key column per table (unique, used for get/update). */
export const TABLE_KEYS: Record<TableName, string> = {
  Complaints: 'complaint_id',
  Access_Credentials: 'complaint_id',
  Found_Items: 'item_id',
  Claim_Requests: 'claim_id',
  Complaint_Updates: 'update_id',
  Handover_Records: 'handover_id',
  Activity_Log: 'log_id',
  Application_Settings: 'key',
  Student_Registry: 'student_id',
  Guest_Identities: 'uid',
  Staff_Roles: 'email',
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  collection_office: 'Student Affairs Office, Ground Floor, Admin Block',
  collection_hours: 'Mon–Sat, 10:00 AM – 4:30 PM',
  contact_email: '',
  contact_phone: '',
  unclaimed_days: '60',
  retention_days: '180',
  require_two_staff: 'false',
  submissions_open: 'true',
  guest_reports_open: 'true',
};
export const EDITABLE_SETTINGS = Object.keys(DEFAULT_SETTINGS);

// ---------- Validation (shared by frontend and backend) ----------
/* eslint-disable no-control-regex -- intentionally strips control characters */
const clean = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(min).max(max));
const optionalClean = (max: number) =>
  z
    .string()
    .optional()
    .default('')
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));

export const PHONE_RE = /^\+?[0-9][0-9\s-]{7,15}$/;
export const COMPLAINT_ID_RE = /^FB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
/** E.164 phone, e.g. +919876543210. */
export const E164_RE = /^\+[1-9][0-9]{7,14}$/;
export function normalizePhone(raw: string, defaultCc = '+91'): string {
  const d = raw.replace(/[\s()-]/g, '');
  if (/^\+[0-9]+$/.test(d)) return d;
  if (/^0?[6-9][0-9]{9}$/.test(d)) return defaultCc + d.replace(/^0/, '');
  if (/^91[6-9][0-9]{9}$/.test(d)) return '+' + d;
  return d;
}
export function maskPhone(p: string): string {
  return p && p.length > 4 ? p.slice(0, 3) + '•'.repeat(Math.max(0, p.length - 7)) + p.slice(-4) : p ? '••••' : '';
}
/** Masks ID-card / hall-ticket / roll-number-like sequences in public text. */
export function maskSensitive(text: string): string {
  return text.replace(/\b([A-Za-z0-9]{2})([A-Za-z0-9]{3,})([A-Za-z0-9]{2})\b/g, (m, a: string, mid: string, b: string) => (/\d/.test(m) && m.replace(/\D/g, '').length >= 4 ? a + '•'.repeat(mid.length) + b : m));
}

const dateOk = (v: string) => {
  const d = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(d) && d <= Date.now() + 36 * 3600e3 && d >= Date.now() - 400 * 86400e3;
};

/** Reporter (student/guest) complaint. Identity fields come from the verified session, never from this body. */
export const complaintInput = z.object({
  guestName: optionalClean(80),
  email: optionalClean(120).refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email'),
  category: z.enum(CATEGORIES),
  itemName: clean(80, 2),
  description: clean(1000, 10),
  colorFeatures: clean(300, 2),
  lastSeenLocation: clean(160, 2),
  lostDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').refine(dateOk, 'Date must be within the last year and not in the future'),
  lostTime: optionalClean(5).refine((v) => v === '' || /^\d{2}:\d{2}$/.test(v), 'Invalid time'),
  ownershipEvidence: clean(1000, 10),
  visitInfo: optionalClean(300),
});
export type ComplaintInput = z.input<typeof complaintInput>;

export const imageUpload = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().max(4_200_000), // ~3 MB decoded
});
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const portalUpdateInput = z.object({
  email: optionalClean(120).refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email'),
  extraInfo: optionalClean(1000),
});

export const claimInput = z.object({
  itemId: z.string().regex(/^FI-[0-9A-HJKMNP-TV-Z]{8}$/),
  evidence: clean(1000, 10),
});

export const proxyInput = z.object({
  proxyName: clean(80, 2),
  proxyPhone: z.string().transform((v) => normalizePhone(v)).pipe(z.string().regex(E164_RE, 'Enter a valid mobile number with country code')),
  consent: z.literal(true),
});

export const foundItemInput = z.object({
  category: z.enum(CATEGORIES),
  itemName: clean(80, 2),
  publicDescription: clean(500, 5),
  privateDetails: optionalClean(1000),
  colorFeatures: clean(300, 2),
  foundLocation: clean(160, 2),
  foundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  foundTime: optionalClean(5).refine((v) => v === '' || /^\d{2}:\d{2}$/.test(v), 'Invalid time'),
  storageLocation: clean(120, 2),
});

export const statusUpdateInput = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  note: optionalClean(500),
});

export const claimDecisionInput = z.object({
  decision: z.enum(['approve', 'reject', 'dispute']),
  notes: clean(500, 3),
  checks: z
    .object({
      evidenceMatches: z.boolean(),
      featuresMatch: z.boolean(),
      noConflictingClaims: z.boolean(),
    })
    .optional(),
  collectionInstructions: optionalClean(500),
});

export const handoverStartInput = z.object({
  claimId: z.string().regex(/^CL-[0-9A-HJKMNP-TV-Z]{8}$/),
  receiverType: z.enum(['owner', 'proxy']),
  receiverName: clean(80, 2),
  receiverIdType: z.enum(['College ID card', 'Aadhaar', 'Driving licence', 'Passport', 'Voter ID', 'Other government ID']),
  receiverIdLast4: z.string().regex(/^[A-Za-z0-9]{4}$/, 'Last 4 characters only'),
  notes: optionalClean(500),
});

export const acknowledgeInput = z.object({
  code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code shown at the counter'),
  signatureName: clean(80, 2),
  accept: z.literal(true),
  signature: imageUpload.optional(),
});

export const releaseInput = z.object({
  confirmPhysicalRelease: z.literal(true),
  notes: optionalClean(500),
});

export const registryRowInput = z.object({
  studentId: clean(30, 2).refine((v) => /^[A-Za-z0-9/_.-]+$/.test(v), 'Use letters, numbers, / _ . -').transform((v) => v.toUpperCase()),
  name: clean(80, 2),
  department: clean(80, 1),
  year: optionalClean(20),
  phone: z.string().transform((v) => normalizePhone(v)).pipe(z.string().regex(E164_RE, 'Invalid mobile number')),
  email: optionalClean(120),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const staffRoleInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(ROLES),
  name: optionalClean(80),
  status: z.enum(['active', 'disabled']).default('active'),
});

/** Status rank for timeline rendering (side statuses return -1). */
export function statusRank(s: string): number {
  return (MAIN_STATUSES as readonly string[]).indexOf(normalizeStatus(s));
}
