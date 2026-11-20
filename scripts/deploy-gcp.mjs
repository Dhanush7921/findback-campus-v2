#!/usr/bin/env node
// One-command setup + deploy of FindBack V2 (Cloud Run API, Firebase phone/Google sign-in, GitHub Pages), browser sign-in only.
//   npm run deploy:gcp
// Safe by design:
//   * Uses its OWN Google Cloud project, service, bucket and secrets (FB2_*). It never touches FindBack V1 resources.
//   * Points at the STAGING sheet by default. Production data is used only with DATA_ENV=production + explicit "yes".
//   * No service-account key files. Secrets are generated once into Secret Manager and never printed.
//   * Billing is linked only after you type "yes". Re-running is safe (idempotent).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';

const REPO = 'Dhanush7921/findback-campus-v2';
const STAGING_SHEET = '1xvuMd8AA95EwYZvZuGC-WHB2nxsRbG9-AzpHR0fphAI';
const PRODUCTION_SHEET = '1hxlYTgj99bMlkx4xWVWVmkUvqfQxWGsu704t-DHygvU';
const REGION = 'asia-south1';
const SERVICE = 'findback-v2-api';
const PAGES_HOST = 'dhanush7921.github.io';
const ORIGINS = [`https://${PAGES_HOST}`, 'https://localhost', 'capacitor://localhost', ...(process.env.EXTRA_ORIGINS ? [process.env.EXTRA_ORIGINS] : [])].join(',');
const DATA_ENV = process.env.DATA_ENV === 'production' ? 'production' : 'staging';
const WIN = process.platform === 'win32';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { shell: WIN, encoding: 'utf8', ...opts });
const gc = (args, opts) => sh('gcloud', args, opts);
const out = (args) => { const r = gc(args); return r.status === 0 ? r.stdout.trim() : ''; };
const must = (args, what) => { const r = gc(args, { stdio: 'inherit' }); if (r.status !== 0) fail(`${what} failed (see above).`); };
const step = (s) => console.log(`\n=== ${s}`);
function fail(s) { console.error(`\n✖ ${s}`); process.exit(1); }
async function gapi(method, url, body, project) {
  const token = out(['auth', 'print-access-token']);
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': project }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
async function waitOp(name, project) {
  for (let i = 0; i < 30; i++) {
    const r = await gapi('GET', `https://firebase.googleapis.com/v1beta1/${name}`, null, project);
    if (r.j.done) return r.j;
    await new Promise((res) => setTimeout(res, 3000));
  }
  return null;
}

step('1/10 Google Cloud CLI');
if (gc(['--version']).status !== 0) fail('gcloud is not installed. Install it from https://cloud.google.com/sdk/docs/install, open a new terminal, and re-run.');
if (!out(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'])) {
  console.log('A browser window will open. Review and approve the Google Cloud sign-in there.');
  must(['auth', 'login'], 'Google sign-in');
}
const me = out(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
console.log(`Signed in as ${me}`);

step('2/10 Project (a NEW project just for V2)');
let project = process.env.GCP_PROJECT || '';
const existing = out(['projects', 'list', '--format=value(projectId)']).split(/\s+/).filter(Boolean);
if (!project) {
  const v2 = existing.find((p) => p.startsWith('findback-v2-'));
  const def = v2 || `findback-v2-${randomBytes(2).toString('hex')}`;
  project = (await ask(`Project ID for FindBack V2 [${def}]: `)).trim() || def;
}
if (!existing.includes(project)) must(['projects', 'create', project, '--name=FindBack V2'], 'Project creation');
must(['config', 'set', 'project', project], 'Selecting project');

step('3/10 Billing (needed for Cloud Run and SMS codes; small colleges normally stay within free tiers, SMS is billed per message)');
if (out(['billing', 'projects', 'describe', project, '--format=value(billingEnabled)']) !== 'True') {
  const accounts = out(['billing', 'accounts', 'list', '--filter=open=true', '--format=value(name,displayName)']).split('\n').filter(Boolean);
  if (!accounts.length) fail('No billing account found. Create one at https://console.cloud.google.com/billing, then re-run.');
  accounts.forEach((a, i) => console.log(`  [${i + 1}] ${a.replace('\t', '  ')}`));
  const pick = Number((await ask('Billing account number to link: ')).trim() || '1') - 1;
  const acct = accounts[pick]?.split('\t')[0];
  if (!acct) fail('Invalid choice.');
  if ((await ask(`Link billing account ${acct} to ${project}? Type "yes" to approve: `)).trim().toLowerCase() !== 'yes') fail('Billing not approved; nothing else was changed.');
  must(['billing', 'projects', 'link', project, `--billing-account=${acct.replace('billingAccounts/', '')}`], 'Linking billing');
}
console.log('Billing enabled.');

step('4/10 Enable APIs');
must(['services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'secretmanager.googleapis.com',
  'sheets.googleapis.com', 'storage.googleapis.com', 'iam.googleapis.com', 'logging.googleapis.com',
  'firebase.googleapis.com', 'identitytoolkit.googleapis.com'], 'Enabling APIs');

step('5/10 Firebase Authentication (phone codes + staff Google sign-in)');
let fb = await gapi('GET', `https://firebase.googleapis.com/v1beta1/projects/${project}`, null, project);
if (!fb.ok) {
  const add = await gapi('POST', `https://firebase.googleapis.com/v1beta1/projects/${project}:addFirebase`, {}, project);
  if (!add.ok) fail(`Adding Firebase failed: ${JSON.stringify(add.j.error?.message ?? add.status)}`);
  await waitOp(add.j.name, project);
}
let apps = await gapi('GET', `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`, null, project);
let app = apps.j.apps?.find((a) => a.displayName === 'FindBack V2 Web');
if (!app) {
  const c = await gapi('POST', `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`, { displayName: 'FindBack V2 Web' }, project);
  if (!c.ok) fail(`Creating Firebase web app failed: ${c.j.error?.message ?? c.status}`);
  app = (await waitOp(c.j.name, project))?.response;
}
const webCfg = (await gapi('GET', `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps/${app.appId}/config`, null, project)).j;
if (!webCfg.apiKey) fail('Could not read the Firebase web config.');
// Phone provider + authorised domains (Identity Platform admin API).
const idp = await gapi('PATCH', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config?updateMask=signIn.phoneNumber.enabled,authorizedDomains`,
  { signIn: { phoneNumber: { enabled: true } }, authorizedDomains: ['localhost', `${project}.firebaseapp.com`, `${project}.web.app`, PAGES_HOST] }, project);
if (!idp.ok) fail(`Enabling phone sign-in failed: ${idp.j.error?.message ?? idp.status}`);
console.log('Phone sign-in enabled; authorised domain:', PAGES_HOST);
const google = await gapi('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs/google.com`, null, project);
if (!google.ok || !google.j.enabled) {
  console.log(`\nStaff sign-in needs Google enabled once (Google creates its OAuth client only from the console):\n  https://console.firebase.google.com/project/${project}/authentication/providers\n  → Add new provider → Google → Enable → pick support email → Save.`);
  await ask('Press Enter when done… ');
}

step('6/10 Service account (least privilege, no key files)');
const sa = `${SERVICE}@${project}.iam.gserviceaccount.com`;
if (!out(['iam', 'service-accounts', 'describe', sa, '--format=value(email)'])) must(['iam', 'service-accounts', 'create', SERVICE, '--display-name=FindBack V2 API (Cloud Run)'], 'Creating service account');
must(['projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${sa}`, '--role=roles/logging.logWriter', '--condition=None', '--quiet'], 'Logging role');

step('7/10 Private storage bucket and secrets');
const bucket = `${project}-private`;
if (gc(['storage', 'buckets', 'describe', `gs://${bucket}`]).status !== 0) {
  must(['storage', 'buckets', 'create', `gs://${bucket}`, `--location=${REGION}`, '--uniform-bucket-level-access', '--public-access-prevention'], 'Creating bucket');
}
must(['storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`, `--member=serviceAccount:${sa}`, '--role=roles/storage.objectAdmin', '--quiet'], 'Bucket access');
for (const name of ['FB2_HASH_PEPPER', 'FB2_SESSION_KEY']) {
  if (gc(['secrets', 'describe', name]).status !== 0) {
    const r = gc(['secrets', 'create', name, '--replication-policy=automatic', '--data-file=-'], { input: randomBytes(32).toString('base64url') });
    if (r.status !== 0) fail(`Creating secret ${name} failed: ${r.stderr}`);
    console.log(`Created ${name} (random, stored only in Secret Manager).`);
  } else console.log(`${name} already exists, kept unchanged.`);
  must(['secrets', 'add-iam-policy-binding', name, `--member=serviceAccount:${sa}`, '--role=roles/secretmanager.secretAccessor', '--quiet'], `Secret access for ${name}`);
}

step(`8/10 Data sheet (${DATA_ENV})`);
let sheet = STAGING_SHEET;
if (DATA_ENV === 'production') {
  if ((await ask('PRODUCTION mode: the API will read and write the live FindBack sheet. Type "yes" to approve: ')).trim().toLowerCase() !== 'yes') fail('Production not approved.');
  sheet = PRODUCTION_SHEET;
}
console.log(`Open https://docs.google.com/spreadsheets/d/${sheet}/edit → Share → add\n  ${sa}\nas Editor (untick "Notify people"), then press Enter here.`);
await ask('Press Enter once shared… ');
const admins = (await ask(`Main admin Google account(s), comma-separated [${me}]: `)).trim() || me;

step('9/10 Deploy to Cloud Run (Cloud Build; takes a few minutes)');
const envVars = [`SHEET_ID=${sheet}`, `BUCKET=${bucket}`, `DATA_ENV=${DATA_ENV}`, `ALLOWED_ORIGINS=${ORIGINS}`, `BOOTSTRAP_ADMINS=${admins}`,
  `STAFF_DOMAIN=${process.env.STAFF_DOMAIN || ''}`, `FIREBASE_PROJECT_ID=${project}`, `FIREBASE_API_KEY=${webCfg.apiKey}`,
  `FIREBASE_AUTH_DOMAIN=${webCfg.authDomain}`, `FIREBASE_APP_ID=${webCfg.appId}`];
must(['run', 'deploy', SERVICE, '--source', '.', `--region=${REGION}`, `--service-account=${sa}`, '--allow-unauthenticated',
  // One instance keeps the in-memory sheet cache and write ordering consistent; see docs/OPERATIONS.md for capacity.
  '--max-instances=1', '--min-instances=0', '--concurrency=80', '--cpu=1', '--memory=512Mi', '--timeout=60',
  `--set-env-vars=^##^${envVars.join('##')}`, '--set-secrets=HASH_PEPPER=FB2_HASH_PEPPER:latest,SESSION_KEY=FB2_SESSION_KEY:latest', '--quiet'], 'Cloud Run deploy');
const url = out(['run', 'services', 'describe', SERVICE, `--region=${REGION}`, '--format=value(status.url)']);
if (!url) fail('Deployed, but could not read the service URL.');
let health = null;
for (let i = 0; i < 8 && !health?.storeReachable; i++) {
  try { health = await (await fetch(`${url}/api/health`)).json(); } catch { /* retry */ }
  if (!health?.storeReachable) await new Promise((r) => setTimeout(r, 5000));
}
console.log('Health:', JSON.stringify(health));
if (!health?.storeReachable) fail(`The API is up but cannot reach the sheet. Check it is shared with ${sa} as Editor, wait a minute, and re-run.`);

step('10/10 GitHub Pages + Android build');
if (sh('gh', ['--version']).status !== 0) {
  console.log(`GitHub CLI not found. Add repository variable VITE_API_BASE = ${url} at https://github.com/${REPO}/settings/variables/actions and enable Pages (Source: GitHub Actions).`);
} else {
  if (sh('gh', ['auth', 'status']).status !== 0) sh('gh', ['auth', 'login', '--web', '-h', 'github.com'], { stdio: 'inherit' });
  sh('gh', ['api', '-X', 'POST', `repos/${REPO}/pages`, '-f', 'build_type=workflow']); // no-op if already enabled
  if (sh('gh', ['variable', 'set', 'VITE_API_BASE', '-b', url, '-R', REPO], { stdio: 'inherit' }).status !== 0) fail('Could not set VITE_API_BASE.');
  sh('gh', ['workflow', 'run', 'deploy-pages.yml', '-R', REPO, '--ref', 'main'], { stdio: 'inherit' });
  sh('gh', ['workflow', 'run', 'android.yml', '-R', REPO, '--ref', 'main'], { stdio: 'inherit' });
}
rl.close();
console.log(`\n✔ FindBack V2 API (${DATA_ENV}) live: ${url}\n  Website: https://${PAGES_HOST}/findback-campus-v2/ (ready in ~3 min)\n  Builds: https://github.com/${REPO}/actions`);
