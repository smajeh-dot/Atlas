import { invoke } from '@tauri-apps/api/core';
import type { Db, Statement } from '../data/db';

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // The Rust side rejects with a plain string; give callers a real Error.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const tauriDb: Db = {
  query: <T>(sql: string, params?: unknown[]) => call<T[]>('db_query', { sql, params: params ?? [] }),
  execute: (sql: string, params?: unknown[]) =>
    call<{ changes: number; lastInsertId: number }>('db_execute', { sql, params: params ?? [] }),
  batch: (statements: Statement[]) =>
    call<void>('db_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
};

export interface AppInfo {
  dataDir: string;
  dbPath: string;
  version: string;
}

export function getAppInfo(): Promise<AppInfo> {
  return call<AppInfo>('app_info', {});
}
