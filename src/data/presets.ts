import type { Preset, PresetConfig } from '../core/model';
import { validatePresetPatch } from '../core/validate';
import type { Db } from './db';
import { toPreset } from './rows';

export class PresetInUseError extends Error {}

export class PresetConfigError extends Error {
  constructor(readonly fields: Partial<Record<keyof PresetConfig, string>>) {
    super('Some deck options need fixing.');
  }
}

function check(config: Partial<PresetConfig>): void {
  const fields = validatePresetPatch(config);
  if (Object.keys(fields).length) throw new PresetConfigError(fields);
}

export async function listPresets(db: Db): Promise<Preset[]> {
  return (await db.query(`SELECT * FROM presets ORDER BY id`)).map(toPreset);
}

export async function getPreset(db: Db, id: number): Promise<Preset> {
  const [row] = await db.query(`SELECT * FROM presets WHERE id = ?`, [id]);
  if (!row) throw new Error(`Preset ${id} does not exist`);
  return toPreset(row);
}

export async function createPreset(db: Db, name: string, config: PresetConfig): Promise<number> {
  check(config);
  const r = await db.execute(`INSERT INTO presets (name, config) VALUES (?, ?)`, [name.trim(), JSON.stringify(config)]);
  return r.lastInsertId;
}

export async function updatePreset(
  db: Db,
  id: number,
  patch: { name?: string; config?: Partial<PresetConfig> },
): Promise<void> {
  if (patch.config) check(patch.config);
  const p = await getPreset(db, id);
  await db.execute(`UPDATE presets SET name = ?, config = ? WHERE id = ?`, [
    patch.name?.trim() ?? p.name,
    JSON.stringify({ ...p.config, ...patch.config }),
    id,
  ]);
}

export async function deletePreset(db: Db, id: number): Promise<void> {
  if (id === 1) throw new Error('The Default preset cannot be deleted');
  const used = await db.query(`SELECT 1 FROM decks WHERE preset_id = ? LIMIT 1`, [id]);
  if (used.length) throw new PresetInUseError('This preset is used by at least one deck');
  await db.execute(`DELETE FROM presets WHERE id = ?`, [id]);
}
