export interface Statement {
  sql: string;
  params?: unknown[];
}

/** SQLite access. The app uses the Tauri bridge; tests use Node's built-in node:sqlite. SQL uses `?` parameters. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertId: number }>;
  /** Runs every statement in one transaction: all or nothing. */
  batch(statements: Statement[]): Promise<void>;
}
