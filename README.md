# FindBack V2 — campus lost & found

Live site: https://dhanush7921.github.io/findback-campus-v2/

Four portals:
- **Student**: phone OTP sign-in, checked against the college registry. Students report items, track them, see matches, submit evidence, confirm receipt and get notifications.
- **Guest**: phone OTP sign-in. Guests report with visit info and track only their own complaints.
- **Main Admin**: staff Google sign-in. Admins register found items, match, verify claims, run handovers, manage the registry, roles and settings. Every action is audited.
- **Management**: staff Google sign-in, read-only. Analytics, trends, hotspots, redacted records, audit, policies and CSV export.

English and Telugu. Installable PWA plus an Android app (Capacitor). The source is iOS-ready.

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
