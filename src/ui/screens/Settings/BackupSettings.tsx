import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo, BackupKind } from '../../../platform/backupBridge';
import { SettingsError } from '../../../data/settings';
import { useAtlas } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Toggle } from '../../components/Toggle';
import { useToast } from '../../components/Toast';
import styles from './Settings.module.css';

const KIND_LABELS: Record<BackupKind, string> = {
  daily: 'Daily',
  manual: 'Back up now',
  'pre-delete': 'Before a delete',
  'pre-import': 'Before an import',
  'pre-restore': 'Before a restore',
  'pre-upgrade': 'Before an upgrade',
};

export function formatBackupTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BackupSettings() {
  const { deps, settings, saveSettings, reloadSettings, changed, navigate } = useAtlas();
  const toast = useToast();
  const backups = deps.backups;
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<BackupInfo | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!backups) return;
    try {
      setList(await backups.list());
    } catch {
      setList([]);
    }
  }, [backups]);
  useEffect(() => void load(), [load]);

  if (!backups) {
    return (
      <section className={styles.section} aria-label="Backups">
        <h2 className={styles.heading}>Backups</h2>
        <p className={styles.help}>Backups aren't available in this preview.</p>
      </section>
    );
  }

  const newest = list?.reduce<BackupInfo | null>((n, b) => (!n || b.createdAt > n.createdAt ? b : n), null) ?? null;

  const saveSwitch = async (on: boolean) => {
    try {
      await saveSettings({ autoBackup: on });
    } catch (e) {
      toast.show({ message: e instanceof SettingsError ? e.message : `Atlas couldn't save that setting: ${message(e)}` });
    }
  };

  const backUpNow = async () => {
    setBusy(true);
    try {
      await backups.backupNow();
      toast.show({ message: 'Backup saved' });
    } catch (e) {
      toast.show({ message: `Atlas couldn't make a backup: ${message(e)}` });
    } finally {
      setBusy(false);
      void load();
    }
  };

  const restore = async (b: BackupInfo) => {
    setConfirming(null);
    setBusy(true);
    setRestoreError(null);
    try {
      await backups.restore(b.name);
      // The data underneath was replaced: nothing in Undo applies any more, and the settings may differ.
      deps.undo.clear();
      await reloadSettings();
      changed();
      navigate({ name: 'today' });
      toast.show({ message: `Restored your cards to ${formatBackupTime(b.createdAt)}` });
    } catch (e) {
      setRestoreError(message(e));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-label="Backups">
      <h2 className={styles.heading}>Backups</h2>
      <div className={styles.toggles}>
        <Toggle label="Automatic backups" checked={settings.autoBackup} onChange={(v) => void saveSwitch(v)} />
      </div>
      <p className={styles.help}>
        Atlas saves a copy of your cards once a day and just before you delete a deck or a note, and keeps the newest 7 daily copies.
        Copies made before an import, an upgrade or a restore, and by Back up now, are always made.
      </p>
      <p className={styles.version}>{newest ? `Last backup: ${formatBackupTime(newest.createdAt)}` : list ? 'No backups yet' : ''}</p>
      <div>
        <Button variant="secondary" disabled={busy} onClick={() => void backUpNow()}>Back up now</Button>
      </div>
      {restoreError && <p role="alert" className={styles.error}>{restoreError}</p>}
      {list && list.length > 0 && (
        <>
          <h3 className={styles.subheading}>Restore from backup</h3>
          <p className={styles.help}>Pick a backup to put your cards back as they were then. Atlas saves a copy of your current cards first.</p>
          <ul aria-label="Backups" className={styles.backupList}>
            {list.map((b) => (
              <li key={b.name} className={styles.backupRow}>
                <span>
                  <span className={styles.backupWhen}>{formatBackupTime(b.createdAt)}</span>
                  <span className={styles.meta}>{KIND_LABELS[b.kind]} · {formatBytes(b.sizeBytes)}</span>
                </span>
                <Button size="sm" disabled={busy} aria-label={`Restore the backup from ${formatBackupTime(b.createdAt)}`} onClick={() => setConfirming(b)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirming && (
        <Dialog
          title={`Restore your cards to ${formatBackupTime(confirming.createdAt)}?`}
          confirmLabel="Restore"
          confirmVariant="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => void restore(confirming)}
        >
          <p style={{ margin: 0 }}>
            Everything you've done since then will be undone. Before restoring, Atlas saves a copy of your cards as they are now, so you can go back.
          </p>
        </Dialog>
      )}
    </section>
  );
}
