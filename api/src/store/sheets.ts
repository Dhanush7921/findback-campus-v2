import { TABLES, TABLE_KEYS, type Row, type TableName } from '../../../shared/domain';
import { MemoryStore } from './memory';
import { StoreError, type FileData, type Op, type OpResult, type SchemaChange, type Store } from './types';

/** Supplies OAuth access tokens (Cloud Run service identity, or a local developer token). */
export type TokenSource = () => Promise<string>;

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const GCS = 'https://storage.googleapis.com';
const TABLE_NAMES = Object.keys(TABLES) as TableName[];
const colLetter = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** Same formula-injection escaping as the Apps Script layer, so existing rows stay compatible. */
export const toCell = (v: unknown) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
export const fromCell = (v: unknown) => { const s = v == null ? '' : String(v); return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s; };

/**
 * Google Sheets store for Cloud Run (single instance, max-instances=1).
 * All tabs are held in memory (MemoryStore gives identical op semantics to the Apps Script layer) and every write
 * batch is persisted to the spreadsheet before the next write starts. Reads are served from memory, which removes
 * per-request Sheets API calls; the cache is re-read from the sheet periodically and after any failed write.
 * Photos and backups go to a private Cloud Storage bucket; access is enforced by the API, never by public URLs.
 */
export class SheetsStore implements Store {
  private mem: MemoryStore | null = null;
  private loading: Promise<void> | null = null;
  private loadedAt = 0;
  private tabIds: Record<string, number> = {};
  private chain: Promise<unknown> = Promise.resolve();
  private migratedOnce = false;

  constructor(
    private sheetId: string,
    private bucket: string,
    private token: TokenSource,
    private opts: { refreshMs?: number; fetchImpl?: typeof fetch; now?: () => number; autoMigrate?: boolean } = {},
  ) {}

  private now() { return (this.opts.now ?? Date.now)(); }

  private async api(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(url, { ...init, headers: { authorization: `Bearer ${await this.token()}`, ...(init.headers ?? {}) } });
    } catch (e) {
      if (attempt < 3) return this.retry(url, init, attempt);
      throw new StoreError('unavailable', String(e));
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) return this.retry(url, init, attempt);
    if (res.status === 429) throw new StoreError('quota');
    if (res.status === 403 || res.status === 404) throw new StoreError('not_configured', `${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  private async retry(url: string, init: RequestInit, attempt: number) {
    await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random())));
    return this.api(url, init, attempt + 1);
  }

  private async meta() {
    const res = await this.api(`${SHEETS}/${this.sheetId}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties)')}`);
    if (!res.ok) throw new StoreError('unavailable', `sheets ${res.status}`);
    return ((await res.json()) as { sheets: { properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } } }[] }).sheets.map((x) => x.properties);
  }

  /** Compares tab names and header rows with the schema. Read-only. */
  async schemaPlan(): Promise<SchemaChange[]> {
    const tabs = await this.meta();
    const titles = new Set(tabs.map((t) => t.title));
    const present = TABLE_NAMES.filter((t) => titles.has(t));
    const headers: Record<string, string[]> = {};
    if (present.length) {
      const ranges = present.map((t) => `ranges=${encodeURIComponent(`${t}!1:1`)}`).join('&');
      const res = await this.api(`${SHEETS}/${this.sheetId}/values:batchGet?${ranges}`);
      if (!res.ok) throw new StoreError('unavailable', `sheets ${res.status}`);
      const body = (await res.json()) as { valueRanges: { values?: string[][] }[] };
      present.forEach((t, i) => { headers[t] = (body.valueRanges[i]?.values?.[0] ?? []).map((h) => String(h).trim()); });
    }
    const plan: SchemaChange[] = [];
    for (const t of TABLE_NAMES) {
      const cols = TABLES[t] as readonly string[];
      if (!titles.has(t)) { plan.push({ table: t, action: 'create_tab', columns: [...cols] }); continue; }
      const h = headers[t].filter((x, i) => x || i < cols.length);
      const prefixOk = h.every((x, i) => x === cols[i]);
      if (!prefixOk || h.length > cols.length) plan.push({ table: t, action: 'conflict', columns: [], detail: `header differs from schema at column ${h.findIndex((x, i) => x !== cols[i]) + 1}` });
      else if (h.length < cols.length) plan.push({ table: t, action: 'append_columns', columns: cols.slice(h.length) });
    }
    return plan;
  }

  /** Backs up every existing tab to the private bucket, then applies only additive changes. */
  async migrate(): Promise<{ applied: string[]; backupId: string }> {
    return this.locked(async () => {
      const plan = await this.schemaPlan();
      const conflicts = plan.filter((p) => p.action === 'conflict');
      if (conflicts.length) throw new StoreError('rejected', `schema conflict: ${conflicts.map((c) => `${c.table} ${c.detail}`).join('; ')}`);
      const tabs = await this.meta();
      const existing = tabs.filter((t) => (TABLE_NAMES as string[]).includes(t.title));
      let backupId = 'none';
      if (existing.length) {
        const ranges = existing.map((t) => `ranges=${encodeURIComponent(t.title)}`).join('&');
        const res = await this.api(`${SHEETS}/${this.sheetId}/values:batchGet?${ranges}`);
        if (!res.ok) throw new StoreError('unavailable', `backup read ${res.status}`);
        backupId = `backups/pre-migration-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.json`;
        const up = await this.api(`${GCS}/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(backupId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await res.text() });
        if (!up.ok) throw new StoreError('unavailable', `backup write ${up.status}`);
      }
      if (!plan.length) return { applied: [], backupId };
      const headerCells = (cols: string[]) => [{ values: cols.map((c) => ({ userEnteredValue: { stringValue: c }, userEnteredFormat: { textFormat: { bold: true } } })) }];
      const create: object[] = [];
      for (const p of plan.filter((x) => x.action === 'create_tab')) {
        create.push({ addSheet: { properties: { title: p.table, gridProperties: { rowCount: 1000, columnCount: p.columns.length, frozenRowCount: 1 } } } });
      }
      if (create.length) {
        const r = await this.api(`${SHEETS}/${this.sheetId}:batchUpdate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: create }) });
        if (!r.ok) throw new StoreError('unavailable', `create tabs ${r.status}`);
      }
      const after = await this.meta();
      const byTitle = Object.fromEntries(after.map((t) => [t.title, t]));
      const requests: object[] = [];
      for (const p of plan) {
        const tab = byTitle[p.table];
        const cols = TABLES[p.table as TableName] as readonly string[];
        const start = p.action === 'create_tab' ? 0 : cols.length - p.columns.length;
        const have = tab.gridProperties?.columnCount ?? 26;
        if (cols.length > have) requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: cols.length - have } });
        requests.push({ updateCells: { start: { sheetId: tab.sheetId, rowIndex: 0, columnIndex: start }, rows: headerCells(p.columns), fields: 'userEnteredValue,userEnteredFormat.textFormat.bold' } });
      }
      const r = await this.api(`${SHEETS}/${this.sheetId}:batchUpdate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests }) });
      if (!r.ok) throw new StoreError('unavailable', `headers ${r.status}`);
      this.mem = null;
      this.loadedAt = 0;
      return { applied: plan.map((p) => `${p.action} ${p.table}${p.action === 'append_columns' ? ` (+${p.columns.length})` : ''}`), backupId };
    });
  }

  /** Reads all tabs, verifying headers match the schema exactly (never rewrites headers or data). */
  private async load(): Promise<void> {
    const tabs = await this.meta();
    this.tabIds = Object.fromEntries(tabs.map((x) => [x.title, x.sheetId]));
    const missing = TABLE_NAMES.filter((t) => !(t in this.tabIds));
    if (missing.length) {
      if (this.opts.autoMigrate) { await this.migrateUnlocked(); return this.load(); }
      throw new StoreError('not_configured', `schema migration required (missing ${missing.join(', ')})`);
    }
    const ranges = TABLE_NAMES.map((t) => `ranges=${encodeURIComponent(`${t}!A1:${colLetter(TABLES[t].length)}`)}`).join('&');
    const res = await this.api(`${SHEETS}/${this.sheetId}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE`);
    if (!res.ok) throw new StoreError('unavailable', `sheets ${res.status}`);
    const body = (await res.json()) as { valueRanges: { values?: string[][] }[] };
    const mem = new MemoryStore();
    let needsMigration = false;
    TABLE_NAMES.forEach((t, i) => {
      const cols = TABLES[t] as readonly string[];
      const [header = [], ...rows] = body.valueRanges[i]?.values ?? [];
      if (cols.some((c, j) => (header[j] ?? '').trim() !== c)) needsMigration = true;
      mem.tables[t] = rows.map((r) => Object.fromEntries(cols.map((c, j) => [c, fromCell(r[j])])));
    });
    if (needsMigration) {
      if (this.opts.autoMigrate) { await this.migrateUnlocked(); return this.load(); }
      throw new StoreError('not_configured', 'schema migration required (columns)');
    }
    this.mem = mem;
    this.loadedAt = this.now();
  }

  /** Auto-migration (staging only) runs inside load(), which already holds the write lock. */
  private async migrateUnlocked() {
    if (this.migratedOnce) throw new StoreError('not_configured', 'schema migration did not converge');
    this.migratedOnce = true;
    const saved = this.chain;
    this.chain = Promise.resolve();
    try { await this.migrate(); } finally { this.chain = saved; }
  }

  private async ready(): Promise<MemoryStore> {
    const stale = this.now() - this.loadedAt > (this.opts.refreshMs ?? 60_000);
    if (!this.mem || stale) {
      if (!this.loading) {
        // Refresh under the write lock so a reload never races a pending write.
        const p = this.locked(() => this.load());
        this.loading = p.finally(() => { this.loading = null; });
      }
      if (!this.mem) await this.loading;
      else this.loading.catch(() => undefined); // serve the current cache while refreshing in the background
    }
    return this.mem!;
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async exec(ops: Op[]): Promise<OpResult[]> {
    if (!ops.length || ops.length > 25) throw new StoreError('rejected', 'bad_request');
    const writes = ops.some((o) => o.op === 'append' || o.op === 'update');
    if (!writes) return (await this.ready()).exec(ops);
    await this.ready();
    return this.locked(async () => {
      const mem = this.mem!;
      const before = Object.fromEntries(TABLE_NAMES.map((t) => [t, mem.tables[t].length]));
      const results = await mem.exec(ops);
      try {
        await this.persist(mem, ops, results, before);
      } catch (e) {
        this.mem = null; // cache may be ahead of the sheet; force a clean reload
        this.loadedAt = 0;
        throw e instanceof StoreError ? e : new StoreError('unavailable', String(e));
      }
      return results;
    });
  }

  /** Persists one write batch as a single spreadsheets.batchUpdate call (keeps well inside per-minute write quotas). */
  private async persist(mem: MemoryStore, ops: Op[], results: OpResult[], before: Record<string, number>) {
    const cells = (t: TableName, r: Row) => ({ values: (TABLES[t] as readonly string[]).map((c) => ({ userEnteredValue: { stringValue: toCell(r[c]) } })) });
    const requests: object[] = [];
    const appended = new Set<Row>();
    for (const t of TABLE_NAMES) {
      const rows = mem.tables[t].slice(before[t]);
      if (!rows.length) continue;
      rows.forEach((r) => appended.add(r));
      requests.push({ appendCells: { sheetId: this.tabIds[t], rows: rows.map((r) => cells(t, r)), fields: 'userEnteredValue' } });
    }
    ops.forEach((op, i) => {
      if (op.op !== 'update' || !results[i]?.ok) return;
      const rows = mem.tables[op.table];
      const by = op.by ?? TABLE_KEYS[op.table];
      const idx = rows.findIndex((r) => r[by] === op.value);
      if (idx < 0 || appended.has(rows[idx])) return; // appended rows already carry their final state
      requests.push({ updateCells: { start: { sheetId: this.tabIds[op.table], rowIndex: idx + 1, columnIndex: 0 }, rows: [cells(op.table, rows[idx])], fields: 'userEnteredValue' } });
    });
    if (!requests.length) return;
    const res = await this.api(`${SHEETS}/${this.sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) throw new StoreError('unavailable', `write ${res.status}`);
  }

  async uploadFile(name: string, mime: string, dataBase64: string): Promise<string> {
    const id = `photos/${crypto.randomUUID()}`;
    const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
    const res = await this.api(`${GCS}/upload/storage/v1/b/${this.bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': mime, 'x-goog-meta-original-name': encodeURIComponent(name).slice(0, 200) },
      body: bytes,
    });
    if (!res.ok) throw new StoreError('rejected', `upload ${res.status}`);
    return id;
  }

  async getFile(fileId: string): Promise<FileData | null> {
    if (!/^photos\/[0-9a-f-]{36}$/.test(fileId)) return null;
    let res: Response;
    try {
      res = await this.api(`${GCS}/storage/v1/b/${this.bucket}/o/${encodeURIComponent(fileId)}?alt=media`);
    } catch (e) {
      if (e instanceof StoreError && e.code === 'not_configured') return null;
      throw e;
    }
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mime: res.headers.get('content-type') ?? 'application/octet-stream', dataBase64: btoa(bin) };
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!/^photos\/[0-9a-f-]{36}$/.test(fileId)) return;
    await this.api(`${GCS}/storage/v1/b/${this.bucket}/o/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  /** Snapshot of every tab as JSON into the private bucket (backups/...). */
  async backup() {
    const mem = await this.ready();
    const name = `backups/findback-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.json`;
    const res = await this.api(`${GCS}/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mem.tables),
    });
    if (!res.ok) throw new StoreError('unavailable', `backup ${res.status}`);
    return { backupId: name, name };
  }

  /** Redacts personal data on Returned/Closed complaints past retention_until (port of the Apps Script trigger). */
  async retentionSweep(): Promise<number> {
    const mem = await this.ready();
    const nowIso = new Date(this.now()).toISOString();
    const due = mem.tables.Complaints.filter((r) => ['Returned', 'Closed', 'Cancelled', 'Rejected'].includes(r.status) && r.retention_until && r.retention_until < nowIso && r.name !== '[redacted]');
    for (const r of due) {
      if (r.photo_file_id) await this.deleteFile(r.photo_file_id);
      const patch: Row = { photo_file_id: '' };
      for (const c of ['name', 'student_id', 'phone', 'email', 'ownership_evidence', 'extra_info', 'verified_phone', 'visit_info', 'proxy_name', 'proxy_phone']) patch[c] = '[redacted]';
      await this.exec([{ op: 'update', table: 'Complaints', value: r.complaint_id, patch }]);
    }
    return due.length;
  }

  async ping(): Promise<boolean> {
    try {
      await this.ready();
      return true;
    } catch {
      return false;
    }
  }
}
