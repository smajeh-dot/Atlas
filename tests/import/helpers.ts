import { fileURLToPath } from 'node:url';
import { openStaging } from '../helpers/testDb';
import type { StagingSource } from '../../src/import/staging';

/** A staging database the Rust reader produced from one of the real .apkg fixtures. */
export function staged(name: 'rich-modern' | 'rich-modern-nosched' | 'fsrs-modern'): StagingSource {
  return openStaging(fileURLToPath(new URL(`../fixtures/anki/staged/${name}.staging.db`, import.meta.url)));
}

export async function expected(name: string): Promise<{
  generated: { now_ms: number; anki_today: number; tz: string };
  collection: { crt: number; rollover: number };
  cards: { id: number; type: number; queue: number; due: number; odue: number; ivl: number; flags: number }[];
  revlog: { id: number; card_id: number }[];
  notes: { id: number; guid: string; fields: string[] }[];
}> {
  const { readFile } = await import('node:fs/promises');
  const path = fileURLToPath(new URL(`../fixtures/anki/${name}.expected.json`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}
