# Deployment

FindBack V2 uses **its own** Google Cloud project, Cloud Run service (`findback-v2-api`), bucket and secrets (`FB2_*`). It never touches FindBack V1 resources.

## One command (Windows/macOS/Linux)
Prerequisites: Node 22, [gcloud CLI](https://cloud.google.com/sdk/docs/install), [GitHub CLI](https://cli.github.com/) (optional).
```bash
git clone https://github.com/Dhanush7921/findback-campus-v2 && cd findback-campus-v2
npm ci
npm run deploy:gcp
```
The script:
1. Signs you in through your browser (gcloud, then gh).
2. Creates or selects a `findback-v2-*` project.
3. Links billing, only after you type `yes`. Billing is needed for Cloud Run and for SMS codes, which are billed per message.
4. Enables APIs and adds Firebase. It turns on phone sign-in and authorises `dhanush7921.github.io`.
5. Asks you to click **Enable** once for the Google provider in the Firebase console.
6. Creates a service account with no keys, a private bucket with public access prevented, and random secrets in Secret Manager.
7. Asks you to share the **staging** sheet with the service account (one click in the browser).
8. Asks for the main admin Google account(s). The default is you.
9. Deploys to Cloud Run (asia-south1) with `max-instances=1` and checks `/api/health`.
10. Enables GitHub Pages, sets `VITE_API_BASE`, and starts the website and Android builds.

Re-running is safe: existing secrets are kept.

## Staging → production (controlled, reversible)
1. Test everything on staging. Staging tabs are created automatically.
2. Make a manual copy of the production sheet (File → Make a copy). This is your rollback point.
3. Run `DATA_ENV=production npm run deploy:gcp`. You must type `yes`, and you share the production sheet with the service account.
4. Sign in as Main Admin → Settings → **Schema migration**. Review the plan and type `MIGRATE`.
   - The API first backs up every tab as JSON to the private bucket.
   - It then only **adds** new tabs and trailing columns.
   - Existing rows and values are never rewritten. Legacy statuses are mapped when read.
5. Rollback: redeploy with the staging sheet (`npm run deploy:gcp`), or restore the sheet copy. The added columns are harmless to V1.

## Institution data (needed before students can sign in)
- **Student registry**: Admin → Registry → import CSV (`student_id,name,department,year,phone,email`). Only registered, active phones can use the student portal.
- **Staff**: Admin → People → add Google emails as `admin` or `management`.

## Android
GitHub Actions → *Android build* → artifact `findback-debug-apk`. To build signed releases, add the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets.
