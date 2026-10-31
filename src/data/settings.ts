import { DEFAULT_SETTINGS, type Settings } from '../core/model';
import type { Db } from './db';

export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'settings'`);
  const stored: Record<string, unknown> = row ? JSON.parse(row.value) : {};
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key in stored) (out as Record<string, unknown>)[key] = stored[key];
  }
  return out;
}

export async function updateSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings(db)), ...patch };
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)`, [JSON.stringify(next)]);
  return next;
}
