# Security model

**Identity**
- Students and guests prove their phone with Firebase OTP.
- The API verifies the Firebase ID token (RS256, issuer, audience, expiry, auth_time ≤ 7 days, provider).
- It then issues a short HMAC session: 30 minutes for reporters, 4 hours for staff.
- Students must match exactly one active registry row. That match is re-checked on **every** request, and `sessions_valid_after` revokes sessions, for example after a lost phone.

**Roles**
- Staff roles come from the `Staff_Roles` tab (plus bootstrap admins), never from the client.
- Every `/api/staff/*` route requires admin. Management can only use `GET /api/mgmt/*`: personal data is redacted, and exports are logged.

**Attribution**
- Complaint identity fields come from the verified session and registry. Client-supplied `name`, `studentId` and `submitted_by` are ignored.

**Handover**
- The admin starts a handover, which shows a 6-digit code once. Only a keyed hash is stored, and the code expires after 10 minutes.
- The receiver enters it on their own OTP-verified phone. An approved proxy uses their own verified phone.
- The receiver types their name, and can draw a signature, which is stored privately.
- An admin then confirms the physical release (optionally a second staff member).
- 5 wrong codes cancel the handover. Replay returns `already_used`. A complaint becomes Returned only through this flow.

**Evidence (photos, documents, signatures, delivery proof)**
- Validated on the server: declared type plus magic bytes (JPEG, PNG, WebP, PDF), 5 MB per file, 12 files per item or handover. Images are downscaled on the device first, which also strips EXIF/GPS.
- Stored in the private bucket with create-only uploads (`ifGenerationMatch=0`, so an object can never be overwritten).
- Registered in the append-only `Evidence_Files` tab with the entity, Complaint ID, kind, staff identity, time, size and SHA-256.
- There is no API to replace or delete evidence. Handover evidence is frozen once the handover is released or cancelled.
- Every upload is audited (`evidence_uploaded`).
- Management sees evidence read-only. Receiver signatures and delivery addresses are withheld, and each management view is audited (`evidence_viewed`).
- Reporters never receive proof images. Evidence files are kept as handover records and are not removed by the retention sweep.

**Data**
- Sheets are shared only with the service account and owner, never publicly.
- Activity_Log and Complaint_Updates are append-only.
- Cell values are escaped against formula injection, and CSV exports are escaped too.
- Photos, evidence and signatures are in a private bucket with public access prevented. They are served only through role-checked API routes.
- A retention sweep redacts personal data after closure.

**Abuse**
- Per-user and per-IP rate limits on sign-in, submission and acknowledgment.
- A honeypot field and a minimum fill time.
- Idempotency keys.
- A duplicate warning, which never deletes anything.
- At most 10 open complaints per reporter.
- Firebase applies its own SMS abuse protection (reCAPTCHA). The app also applies a resend cooldown.

**Secrets**
- Secrets live in Secret Manager. There are no downloadable service-account keys.
- No secrets in the repo. `.env*` is git-ignored.

**Errors and logs**
- Errors and logs never include request bodies, evidence or full phone numbers.
- Logs carry the request id, method, path, status and latency.

**Web**
- A strict CSP meta tag that allows only self, the API, Firebase Auth and reCAPTCHA.
- Native builds disable WebView debugging.
