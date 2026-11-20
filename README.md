# FindBack V2 — campus lost & found

Live site: https://dhanush7921.github.io/findback-campus-v2/

Public demo: https://dhanush7921.github.io/findback-campus-v2/demo/ — simulated role sign-ins and isolated fictional browser data; no production APIs or records are used.

Four portals:
- **Student**: phone OTP sign-in, checked against the college registry. Students report items, track them, see matches, submit evidence, confirm receipt and get notifications.
- **Guest**: phone OTP sign-in. Guests report with visit info and track only their own complaints.
- **Main Admin**: staff Google sign-in. Admins register found items with multi-photo evidence, match, verify claims, run handovers with Proof of Handover (or optional Home Delivery), and manage the registry, roles and settings. Every action is audited.
- **Management**: staff Google sign-in, read-only. Analytics, trends, hotspots, redacted records, audit, policies and CSV export.

English and Telugu. Installable PWA plus an Android app (Capacitor). The source is iOS-ready.

## CEO demo (sample data only)

Open the site and choose **Explore Demo** (or go to `/demo`). Public demo logins:

| Role | Username | Password |
| --- | --- | --- |
| Student | student@demo.findback | Student@123 |
| Guest | guest@demo.findback | Guest@123 |
| Main Admin | admin@demo.findback | Admin@123 |
| Management | management@demo.findback | Management@123 |

Each role also has a one-click **Enter demo** button. A permanent "DEMO MODE — SAMPLE DATA ONLY" bar is shown, with Switch role, Exit and (demo admin only) Reset demo.

How it stays isolated:
- The demo runs the same FindBack API code **inside the browser** on an in-memory store with fictional records. It makes no requests to Cloud Run, Google Sheets, Cloud Storage or Firebase.
- Demo sign-ins are only accepted by that in-browser copy. The Cloud Run API always runs in production mode (development sign-in off, separate signing keys), so demo credentials and tokens are rejected there. There is no demo flag in the production API.
- Demo data lives in this browser tab's IndexedDB and lasts for the browser session. Reset demo restores the sample data.
- OTP (123456) and handover codes in the demo are simulated and labelled as such. Real OTP and staff sign-in are unchanged.

## Manual edits

Admins can create complaints, edit complaint and found-item details (with a required reason), archive photos/proof (never hard-deleted), add correction notes to claims, and correct handover details until the receiver confirms. Students and guests can edit their own complaint until staff start reviewing it. Management is read-only. Every change is written to the audit log with before → after values. Verified identities, consumed codes, receiver signatures and completed handover evidence cannot be edited.

## Stack
| Part | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind, PWA, on GitHub Pages |
| API | Node/TypeScript on Google Cloud Run (`server/main.ts` → `api/src/app.ts`) |
| Sign-in | Firebase Authentication (phone OTP; Google for staff). The API verifies ID tokens and applies registry and role checks. |
| Data | Google Sheets only (Sheets API, staging and production sheets kept separate). Private photos and signatures go in a private Cloud Storage bucket. |
| Secrets | Secret Manager. There are no service-account key files. |

## Develop
```bash
npm ci
npm run dev:stack      # local API on :8787 (in-memory data, dev sign-in, code 123456)
npm run dev            # site on :5173 (set VITE_API_BASE=http://127.0.0.1:8787)
npm test               # API unit/integration tests
npm run build:e2e && npx playwright test   # browser E2E
npm run test:load      # HTTP load test (measured)
npm run bench:sheets   # write capacity vs modelled Sheets latency
```
Dev sign-in only works with `APP_ENV=development` and `DEV_AUTH=1`. Cloud Run forces production mode.

## Deploy
Run `npm run deploy:gcp` on your own PC. It uses browser sign-in, asks before linking billing, and points at the staging sheet. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Docs: [Security](docs/SECURITY.md) · [Operations](docs/OPERATIONS.md) · [Staff process](docs/STAFF_PROCESS.md) · [Custom domain](docs/CUSTOM_DOMAIN.md)
