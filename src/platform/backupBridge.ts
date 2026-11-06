import { invoke } from '@tauri-apps/api/core';

export type BackupKind = 'daily' | 'manual' | 'pre-delete' | 'pre-import' | 'pre-restore' | 'pre-upgrade';

export interface BackupInfo {
  /** The file's name in the backups folder, such as `daily-1730000000000.db`. */
  name: string;
  kind: BackupKind;
  /** When it was made, in milliseconds since 1970. */
  createdAt: number;
  sizeBytes: number;
}

/** What the app needs from the native side. Tests and previews pass a fake. */
export interface BackupPort {
  create(kind: BackupKind): Promise<BackupInfo>;
  /** Newest first. */
  list(): Promise<BackupInfo[]>;
  /** `maxVersion` is the newest data format this Atlas understands; a newer backup is refused. */
  restore(name: string, maxVersion: number): Promise<void>;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // The Rust side rejects with a plain sentence written for the user; give callers a real Error.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const tauriBackupPort: BackupPort = {
  create: (kind) => call<BackupInfo>('backup_create', { kind }),
  list: () => call<BackupInfo[]>('backup_list'),
  restore: (name, maxVersion) => call<void>('backup_restore', { name, maxVersion }),
};
