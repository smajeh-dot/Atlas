import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { ImportPlatform } from '../import/commit';
import type { MediaInstall } from '../import/media';
import type { StagingSource } from '../import/staging';

/** Matches `ImportError::code()` in the anki-package crate. */
export type ImportFileErrorCode =
  | 'not_an_apkg'
  | 'corrupt'
  | 'unsupported_version'
  | 'only_dummy_collection'
  | 'too_large'
  | 'not_enough_disk_space'
  | 'io';

/** A problem with the chosen file, with a message written for the student. */
export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const x = e as { code: string; message: string; detail?: string };
    return new ImportFileError(x.code as ImportFileErrorCode, x.message, x.detail ?? '');
  }
  return new Error(String(e));
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}

export interface PreparedFile {
  format: string;
  notes: number;
  cards: number;
  reviews: number;
  media: number;
}

/** Shows Windows' Open dialog for an Anki package. Null if the student cancels. */
export async function chooseAnkiFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Anki deck package', extensions: ['apkg'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

/** Reads the file into Atlas's private work folder. Throws ImportFileError for files Atlas can't use. */
export function prepareFile(path: string): Promise<PreparedFile> {
  return call<PreparedFile>('import_prepare', { path });
}

/** Closes the prepared file and deletes the work folder. Safe to call more than once. */
export function finishImport(): Promise<void> {
  return call<void>('import_cleanup');
}

export const tauriStaging: StagingSource = {
  query: <T>(sql: string, params?: unknown[]) => call<T[]>('staging_query', { sql, params: params ?? [] }),
};

export const tauriImportPlatform: ImportPlatform = {
  installMedia: (files: MediaInstall[]) =>
    call<void>('media_install', { files: files.map((f) => ({ stagedPath: f.stagedPath, name: f.name, sha1: f.sha1 })) }),
  removeMedia: (names: string[]) => call<void>('media_remove', { names }),
  backup: () => call<string>('db_backup'),
};

/** "C:\Users\me\Downloads\Chemistry.apkg" → "Chemistry.apkg". */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
