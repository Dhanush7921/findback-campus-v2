# Operations

## Backups and restore
- Admin → Settings → **Backup now** writes every tab as JSON to the private bucket (`backups/`). Schema migrations back up first automatically.
- Restore: copy rows back from the JSON (or a sheet copy) into the sheet, then redeploy or restart the service so it reloads its cache.
- Keep a periodic manual copy of the sheet (File → Make a copy) as well.

## Failure behaviour
- Sheets busy, quota exceeded or outage: the API retries with backoff, then returns `503`. The site never shows success unless the write was confirmed. Idempotency keys stop retries from creating duplicates.
- Firebase SMS limits: users see "SMS limit reached". Admins can raise quotas in the Firebase console.

## Capacity (measured, local, 2026-11-20)
These numbers come from a cloud container, not Cloud Run. Re-measure live with `node tests/load/run-load.mjs --target <url>`.

`npm run test:load`: real API code on Node, in-memory store, autocannon, 5 s per run.

| Scenario | 10 conns | 50 conns |
|---|---|---|
| health | 6,631 req/s, p99 4 ms | 7,551 req/s, p99 13 ms |
| public config | 7,004 req/s, p99 3 ms | 8,164 req/s, p99 11 ms |
| student: my complaints (session + registry check) | 5,161 req/s, p99 4 ms | 6,520 req/s, p99 12 ms |

`npm run bench:sheets`: real API code and SheetsStore against a fake Google API with **modelled** latency (write 500 ms, read 300 ms).

| Scenario | Result |
|---|---|
| Cached reads (my complaints, 50 concurrent) | 3,718 req/s, p95 19 ms |
| Writes (guest sign-in, complaint submit, 20 concurrent) | **2.0 writes/s**, p50 10 s under a 20-deep queue |

Writes are serialised on one instance to keep the sheet consistent, so write throughput is roughly 1 / (Sheets write latency). That is about 7,000 writes per hour, far above a college's normal load of a few hundred complaints a day. During a burst, writes queue: they slow down but are not lost. Reads are served from memory.

**Limits:**
- `max-instances=1` is required for cache consistency.
- The Sheets API quota is 300 write requests per minute per project.
- A very large campus-wide burst would need batching. Moving off Sheets needs the owner's approval.

## Monitoring
- Cloud Run → `findback-v2-api` → Metrics (requests, latency, instance) and Logs. Logs are structured JSON: request id, path, status and ms, with no personal data.
- `GET /api/health` shows store reachability, the data environment and any pending schema change.

## Routine
- **Registry**: re-import the CSV each term. Deactivate students who have left.
- **Staff**: People page. Removing a role takes effect within 30 s.
- **Unclaimed items**: Admin → Unclaimed, after the configured number of days.
