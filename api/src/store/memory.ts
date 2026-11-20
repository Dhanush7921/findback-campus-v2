import { APPEND_ONLY, TABLES, TABLE_KEYS, type Row, type TableName } from '../../../shared/domain';
import type { FileData, Op, OpResult, Store } from './types';

/**
 * In-memory implementation with the same semantics as the Apps Script layer.
 * Used by unit tests and local development only (APP_ENV=development).
 */
export class MemoryStore implements Store {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(TABLES).map((t) => [t, []]));
  files = new Map<string, FileData>();
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;

  exec(ops: Op[]): Promise<OpResult[]> {
    const run = async () => {
      const out: OpResult[] = [];
      for (const op of ops) {
        const r = this.run(op);
        out.push(r);
        if (!r.ok) break;
      }
      return out;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private cols(t: TableName) {
    return TABLES[t] as readonly string[];
  }

  private normalize(t: TableName, row: Row): Row {
    const o: Row = {};
    for (const c of this.cols(t)) o[c] = row[c] == null ? '' : String(row[c]);
    return o;
  }

  private run(op: Op): OpResult {
    const rows = this.tables[op.table];
    if (!rows) return { ok: false, error: 'unknown_table' };
    switch (op.op) {
      case 'get': {
        const by = op.by ?? TABLE_KEYS[op.table];
        const r = op.value ? rows.find((x) => x[by] === op.value) : undefined;
        return { ok: true, row: r ? { ...r } : null };
      }
      case 'query': {
        const where = op.where ?? {};
        let list = rows.filter((r) => Object.entries(where).every(([k, v]) => v === '' || r[k] === v));
        if (op.since) list = list.filter((r) => r.created_at >= op.since!);
        list = [...list].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        if (op.order !== 'asc') list.reverse();
        const total = list.length;
        const offset = Math.max(op.offset ?? 0, 0);
        const limit = Math.min(Math.max(op.limit ?? 50, 1), 5000);
        let page = list.slice(offset, offset + limit).map((r) => ({ ...r }));
        if (op.columns?.length) page = page.map((r) => Object.fromEntries(op.columns!.map((c) => [c, r[c]])));
        return { ok: true, rows: page, total };
      }
      case 'append': {
        if (op.unique) {
          const v = op.row[op.unique] ?? '';
          const dup = v ? rows.find((x) => x[op.unique!] === v) : undefined;
          if (dup) return { ok: false, error: 'duplicate', row: { ...dup } };
        }
        const key = TABLE_KEYS[op.table];
        if (op.table !== 'Activity_Log' && op.table !== 'Complaint_Updates' && rows.some((x) => x[key] === op.row[key])) {
          return { ok: false, error: 'duplicate_key' };
        }
        const row = this.normalize(op.table, op.row);
        rows.push(row);
        return { ok: true, row: { ...row } };
      }
      case 'update': {
        if (APPEND_ONLY.includes(op.table)) return { ok: false, error: 'append_only' };
        const by = op.by ?? TABLE_KEYS[op.table];
        const r = rows.find((x) => x[by] === op.value);
        if (!r) return { ok: false, error: 'not_found' };
        if (op.expectVersion != null && (r.version || '0') !== String(op.expectVersion)) {
          return { ok: false, error: 'conflict', row: { ...r } };
        }
        const key = TABLE_KEYS[op.table];
        for (const [k, v] of Object.entries(op.patch)) if (this.cols(op.table).includes(k) && k !== key) r[k] = String(v);
        if (this.cols(op.table).includes('version')) r.version = String((parseInt(r.version || '0', 10) || 0) + 1);
        return { ok: true, row: { ...r } };
      }
    }
  }

  async uploadFile(_name: string, mime: string, dataBase64: string) {
    const id = `memfile_${++this.seq}_${crypto.randomUUID().slice(0, 8)}`;
    this.files.set(id, { mime, dataBase64 });
    return id;
  }
  async getFile(id: string) {
    return this.files.get(id) ?? null;
  }
  async backup() {
    return { backupId: 'mem-backup', name: 'memory snapshot' };
  }
  async ping() {
    return true;
  }
}
