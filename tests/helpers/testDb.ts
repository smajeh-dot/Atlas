import Database from 'better-sqlite3';
import type { Db, Statement } from '../../src/data/db';
import { migrate } from '../../src/data/migrations';
import { T0 } from './fixtures';

// Mirrors the Rust bridge: booleans become 0/1 and undefined becomes NULL.
function bind(params: unknown[] = []): unknown[] {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));
}

export function createTestDb(): Db {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  const run = (s: Statement) => raw.prepare(s.sql).run(...bind(s.params));
  const tx = raw.transaction((statements: Statement[]) => statements.forEach(run));
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return raw.prepare(sql).all(...bind(params)) as T[];
    },
    async execute(sql: string, params?: unknown[]) {
      const r = run({ sql, params });
      return { changes: r.changes, lastInsertId: Number(r.lastInsertRowid) };
    },
    async batch(statements: Statement[]) {
      tx(statements);
    },
  };
}

export async function createMigratedDb(now: number = T0): Promise<Db> {
  const db = createTestDb();
  await migrate(db, now);
  return db;
}
