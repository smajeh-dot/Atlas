import type { SQLInputValue } from 'node:sqlite';

// Loaded through getBuiltinModule rather than an import so UI tests, which Vite transforms for
// the browser (jsdom), can still use Node's built-in SQLite without Vite trying to bundle it.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
import type { Db, Statement } from '../../src/data/db';
import { migrate } from '../../src/data/migrations';
import { T0 } from './fixtures';

// Binds values the way the Rust bridge does: whole numbers as INTEGER, other numbers as REAL,
// booleans as 0/1 and undefined as NULL.
function bind(params: unknown[] = []): SQLInputValue[] {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1n : 0n;
    if (typeof p === 'number' && Number.isInteger(p)) return BigInt(p);
    if (p === undefined) return null;
    return p as SQLInputValue;
  });
}

export function createTestDb(): Db {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const run = (s: Statement) => raw.prepare(s.sql).run(...bind(s.params));
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return raw.prepare(sql).all(...bind(params)).map((r) => ({ ...r })) as T[];
    },
    async execute(sql: string, params?: unknown[]) {
      const r = run({ sql, params });
      return { changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    async batch(statements: Statement[]) {
      raw.exec('BEGIN');
      try {
        statements.forEach(run);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export async function createMigratedDb(now: number = T0): Promise<Db> {
  const db = createTestDb();
  await migrate(db, now);
  return db;
}

/** A staging database as the Rust reader wrote it, opened read-only like the app does. */
export function openStaging(path: string): Db {
  const raw = new DatabaseSync(path, { readOnly: true });
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return raw.prepare(sql).all(...bind(params)).map((r) => ({ ...r })) as T[];
    },
    async execute() {
      throw new Error('staging is read-only');
    },
    async batch() {
      throw new Error('staging is read-only');
    },
  };
}
