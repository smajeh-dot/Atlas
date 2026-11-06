// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../../src/data/db';
import { getSettings, updateSettings } from '../../../src/data/settings';
import type { BackupInfo } from '../../../src/platform/backupBridge';
import type { BackupService } from '../../../src/services/backupService';
import { formatBackupTime } from '../../../src/ui/screens/Settings/BackupSettings';
import { createMigratedDb } from '../../helpers/testDb';
import { renderApp } from '../../helpers/renderApp';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const daily: BackupInfo = { name: 'daily-1.db', kind: 'daily', createdAt: at(6, 8, 30), sizeBytes: 1_258_291 };
const upgrade: BackupInfo = { name: 'pre-upgrade-2.db', kind: 'pre-upgrade', createdAt: at(5, 20, 15), sizeBytes: 348_160 };

function fakeBackups(db: Db, initial: BackupInfo[]) {
  const state = { files: [...initial], restored: [] as string[], failNow: false, failRestore: undefined as Error | undefined, onRestore: async () => {} };
  const service: BackupService = {
    async ensureDaily() {},
    async beforeDelete() {},
    async beforeUpgrade() {},
    async backupNow() {
      if (state.failNow) throw new Error('disk full');
      const info: BackupInfo = { name: 'manual-3.db', kind: 'manual', createdAt: at(6, 9, 45), sizeBytes: 1000 };
      state.files.unshift(info);
      return info;
    },
    list: async () => [...state.files],
    lastBackup: async () => state.files[0] ?? null,
    async restore(name) {
      if (state.failRestore) throw state.failRestore;
      await state.onRestore();
      state.restored.push(name);
    },
  };
  return { state, service };
}

let db: Db;
beforeEach(async () => {
  db = await createMigratedDb();
});

async function open(initial: BackupInfo[] = [daily, upgrade]) {
  const fake = fakeBackups(db, initial);
  const r = await renderApp({ db, backups: fake.service, route: { name: 'settings', section: 'backups' } });
  await screen.findByRole('heading', { name: 'Backups' });
  return { ...r, ...fake };
}

test('the Automatic backups switch shows the setting and saves a change', async () => {
  const { user } = await open();
  const toggle = screen.getByRole('switch', { name: 'Automatic backups' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await user.click(toggle);
  await waitFor(async () => expect((await getSettings(db)).autoBackup).toBe(false));
  expect(screen.getByRole('switch', { name: 'Automatic backups' }).getAttribute('aria-checked')).toBe('false');
});

test('shows the date of the newest backup, or says there are none', async () => {
  await open();
  expect(await screen.findByText(`Last backup: ${formatBackupTime(daily.createdAt)}`)).toBeTruthy();
});

test('says so when there are no backups yet', async () => {
  await open([]);
  expect(await screen.findByText('No backups yet')).toBeTruthy();
});

test('lists each backup with what it was for and how big it is', async () => {
  await open();
  const list = await screen.findByRole('list', { name: 'Backups' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain(formatBackupTime(daily.createdAt));
  expect(rows[0]!.textContent).toContain('Daily');
  expect(rows[0]!.textContent).toContain('1.2 MB');
  expect(rows[1]!.textContent).toContain('Before an upgrade');
  expect(rows[1]!.textContent).toContain('340 KB');
});

test('Back up now makes a backup and updates the last-backup date', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByText('Backup saved')).toBeTruthy();
  expect(await screen.findByText(`Last backup: ${formatBackupTime(at(6, 9, 45))}`)).toBeTruthy();
});

test('a failed Back up now says why and changes nothing', async () => {
  const { user, state } = await open();
  state.failNow = true;
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByText("Atlas couldn't make a backup: disk full")).toBeTruthy();
  expect(screen.getByText(`Last backup: ${formatBackupTime(daily.createdAt)}`)).toBeTruthy();
});

test('Restore asks first, and Cancel restores nothing', async () => {
  const { user, state } = await open();
  await user.click(await screen.findByRole('button', { name: `Restore the backup from ${formatBackupTime(upgrade.createdAt)}` }));
  const dialog = await screen.findByRole('dialog', { name: `Restore your cards to ${formatBackupTime(upgrade.createdAt)}?` });
  expect(dialog.textContent).toContain('saves a copy of your cards as they are now');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(state.restored).toEqual([]);
  expect(screen.getByRole('heading', { name: 'Backups' })).toBeTruthy();
});

test('confirming restores, forgets Undo, reloads the settings, and goes to the home screen', async () => {
  const { user, state, deps } = await open();
  deps.undo.push({ label: 'x', restore: [] });
  state.onRestore = async () => {
    await updateSettings(db, { dayStartHour: 7 }); // the restored data has a different setting
  };
  await user.click(await screen.findByRole('button', { name: `Restore the backup from ${formatBackupTime(daily.createdAt)}` }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(state.restored).toEqual(['daily-1.db']));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull());
  expect(deps.undo.size).toBe(0);
  expect(await screen.findByText(`Restored your cards to ${formatBackupTime(daily.createdAt)}`)).toBeTruthy();
  // Reopening Settings shows the restored data's setting, not the one from before.
  await user.keyboard('{Control>},{/Control}');
  const hour = await screen.findByRole('button', { name: /^Next day starts at/ });
  expect(hour.textContent).toContain('7am');
});

test('a refused restore shows the reason and stays on the page', async () => {
  const { user, state } = await open();
  state.failRestore = new Error('That backup was made by a newer version of Atlas. Update Atlas to restore it.');
  await user.click(await screen.findByRole('button', { name: `Restore the backup from ${formatBackupTime(daily.createdAt)}` }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('That backup was made by a newer version of Atlas.');
  expect(screen.getByRole('heading', { name: 'Backups' })).toBeTruthy();
});
