import type { Row, TableName } from '../../../shared/domain';

export type Op =
  | { op: 'get'; table: TableName; by?: string; value: string }
  | { op: 'query'; table: TableName; where?: Record<string, string>; offset?: number; limit?: number; order?: 'asc' | 'desc'; since?: string; columns?: string[] }
  | { op: 'append'; table: TableName; row: Row; unique?: string }
  | { op: 'update'; table: TableName; by?: string; value: string; patch: Row; expectVersion?: string };

export type OpResult =
  | { ok: true; row?: Row | null; rows?: Row[]; total?: number }
  | { ok: false; error: 'duplicate' | 'duplicate_key' | 'not_found' | 'conflict' | string; row?: Row };

export interface FileData { mime: string; dataBase64: string }

/**
 * Persistence boundary. Everything above this interface is storage-agnostic, so
 * capacity work (caching layer, sharding, a future approved database) can be
 * done here without touching the API contract or frontend.
 */
export interface Store {
  /** Runs ops in order; batches containing writes are atomic w.r.t. other writers. Stops at first failure. */
  exec(ops: Op[]): Promise<OpResult[]>;
  uploadFile(name: string, mime: string, dataBase64: string): Promise<string>;
  getFile(fileId: string): Promise<FileData | null>;
  backup(): Promise<{ backupId: string; name: string }>;
  ping(): Promise<boolean>;
  /** Differences between the sheet and the V2 schema (missing tabs / appended columns). */
  schemaPlan?(): Promise<SchemaChange[]>;
  /** Backs up, then applies only additive schema changes. Never rewrites existing cells. */
  migrate?(): Promise<{ applied: string[]; backupId: string }>;
}

export interface SchemaChange { table: string; action: 'create_tab' | 'append_columns' | 'conflict'; columns: string[]; detail?: string
}

export class StoreError extends Error {
  constructor(public code: 'unavailable' | 'busy' | 'not_configured' | 'rejected' | 'quota', message?: string) {
    super(message ?? code);
  }
}
