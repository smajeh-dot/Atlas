// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../../src/data/db';
import { listDecks } from '../../../src/data/decks';
import { SafetyBackupError, type BackupService } from '../../../src/services/backupService';
import { UndoStack } from '../../../src/services/undo';
import { createMigratedDb } from '../../helpers/testDb';
import { fixedClock, T0 } from '../../helpers/fixtures';
import { countRows, seedDeck, seedNote } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

vi.mock('../../../src/ui/editor/FieldEditor', () => import('../../helpers/fieldEditorStub'));

let db: Db;
let deck: number;
beforeEach(async () => {
  db = await createMigratedDb();
  deck = await seedDeck(db, 'Chemistry');
  await seedNote({ db, clock: fixedClock(T0), undo: new UndoStack() }, deck, 'basic', ['dog', 'chien']);
});

/** A backup service that records what the app looked like at the moment it was asked, and can be made to fail. */
function recorder(failure?: Error) {
  const seen = { decks: -1, notes: -1, calls: 0 };
  const backups: BackupService = {
    async beforeDelete() {
      seen.calls++;
      seen.decks = (await listDecks(db)).length;
      seen.notes = await countRows(db, 'notes');
      if (failure) throw failure;
    },
    ensureDaily: async () => {},
    beforeUpgrade: async () => {},
    backupNow: async () => { throw new Error('unused'); },
    list: async () => [],
    lastBackup: async () => null,
    restore: async () => {},
  };
  return { backups, seen };
}

type User = Awaited<ReturnType<typeof renderApp>>['user'];

async function deleteDeckFromMenu(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Chemistry options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete Chemistry?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete deck' }));
}
test('deleting a deck makes the safety backup first, while the deck still exists', async () => {
  const { backups, seen } = recorder();
  const { user } = await renderApp({ db, backups });
  await deleteDeckFromMenu(user);
  await waitFor(async () => expect((await listDecks(db)).some((d) => d.id === deck)).toBe(false));
  expect(seen).toEqual({ decks: 1, notes: 1, calls: 1 }); // Chemistry and its note were both still there
});

test('if the safety backup fails the deck is not deleted and the reason is shown plainly', async () => {
  const { backups } = recorder(new SafetyBackupError());
  const { user } = await renderApp({ db, backups });
  await deleteDeckFromMenu(user);
  expect(await screen.findByText(/Atlas couldn't make a safety backup first, so nothing was changed/)).toBeTruthy();
  expect((await listDecks(db)).some((d) => d.id === deck)).toBe(true);
  expect(await countRows(db, 'notes')).toBe(1);
  expect(screen.queryByText(/couldn't change the deck: Atlas couldn't make/)).toBeNull();
});

async function deleteNoteWhileStudying(user: User) {
  await screen.findByRole('button', { name: 'Show answer' });
  await user.keyboard('{Control>}{Delete}{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));
}

test('deleting a note makes the safety backup first, while the note still exists', async () => {
  const { backups, seen } = recorder();
  const { user } = await renderApp({ db, backups, route: { name: 'study', deckId: deck } });
  await deleteNoteWhileStudying(user);
  await waitFor(async () => expect(await countRows(db, 'notes')).toBe(0));
  expect(seen.calls).toBe(1);
  expect(seen.notes).toBe(1);
});

test('if the safety backup fails the note is not deleted and the reason is shown plainly', async () => {
  const { backups } = recorder(new SafetyBackupError());
  const { user } = await renderApp({ db, backups, route: { name: 'study', deckId: deck } });
  await deleteNoteWhileStudying(user);
  expect(await screen.findByText(/Atlas couldn't make a safety backup first, so nothing was changed/)).toBeTruthy();
  expect(await countRows(db, 'notes')).toBe(1);
  expect(screen.queryByText(/couldn't change that card: Atlas couldn't make/)).toBeNull();
});
