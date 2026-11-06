# Automatic backups: design

Branch: `auto-backups-feature`. Approved by the owner in conversation on 2026-11-06.

## Goal

Atlas must not lose a user's cards or review history. Today the only backup is the one taken
just before an Anki import, and the `autoBackup` setting (on by default) is read by nothing.
There is no sync, so the local backup is the only safety net. Silent updates are planned for
later, which makes a backup before each data-format upgrade essential.

## Scope

1. A daily backup, made the first time Atlas opens each day.
2. A safety backup before risky actions: deleting a deck, deleting a note, importing from Anki,
   upgrading the data format, and restoring.
3. A **Backups** section in Settings: the **Automatic backups** switch, **Back up now**, the
   date of the last backup, and **Restore from backup**.
4. The README's "Your data" section describes all of this.

Out of scope (say so in the README, build nothing): backing up `media\`, copies kept off the
computer, an "open the backups folder" button, the auto-updater.

## Decisions

| Decision | Choice |
|---|---|
| Daily backups | Newest 7 kept |
| Manual ("Back up now") | Newest 10 kept, a separate pile |
| Safety copies (before delete, import, restore) | Newest 10 kept, one pile |
| Before-upgrade copies | Newest 3 kept, a separate pile, so deletes never push them out |
| The switch | Controls the daily backup and the before-delete backup. Before-import, before-upgrade, before-restore and Back up now are always on |
| Before-delete throttle | At most one before-delete backup per 10 minutes. The earlier copy still holds everything that existed when it was made |
| Backup fails before a delete | The delete does not happen; Atlas says why. Same rule as import |
| Backup fails before an upgrade | The upgrade does not run; startup shows the reason and Atlas keeps the old data untouched |
| Backup fails on the daily check | Silent; Settings shows that the last attempt failed |
| "Last backup" | The newest backup of any kind |
| A backup of an empty, brand-new database | Not made (nothing to protect) |

## Architecture

Policy lives in TypeScript (easy to test with the project's existing test setup). File work
lives in Rust (the only place that can touch the data folder).

### Rust: a new workspace crate `atlas-backup`

Built and tested without the Tauri system libraries, like `anki-package`. Pure `rusqlite` + `std`.

- **File names:** `<kind>-<epoch ms>.db` in `backups\`. Kinds: `daily`, `manual`, `pre-delete`,
  `pre-import`, `pre-restore`, `pre-upgrade`. The existing `pre-import-<ms>.db` files are valid
  names, so older backups keep working.
- **`create(source_db_path, backups_dir, kind, now_ms)`**: opens a *second* connection to the
  database and runs `VACUUM INTO` a temporary file (`.tmp` suffix), then renames it to its final
  name. A reader never blocks the app's own connection (WAL mode), so the app does not freeze, and
  a backup cut short by a crash or restart never leaves a half-written file that looks real. It
  then removes the oldest files of that kind's pile beyond the pile's limit.
- **`list(backups_dir)`**: kind, time, size and file name for each backup, newest first. Ignores
  anything that is not a backup file. `clean_temps` removes leftover `.tmp` files at launch.
- **`inspect(backup_path)`**: opens a backup read-only, runs `PRAGMA quick_check`, confirms it has
  Atlas's tables, and returns its `schema_version`. A backup describes itself: the schema version
  is stored inside it.
- **Restore helper**: copies a validated backup to `atlas.db.restore.tmp` beside the database so
  the final swap is a single rename.

### Rust: app commands (`src-tauri/src/backup.rs`)

- `backup_create(kind)`, `backup_list()`, `backup_restore(name, max_version)`.
- A lock so a backup and a restore can never overlap.
- `db_backup` (used by import) calls the same code with kind `pre-import`, so import backups also
  get temporary names and tidying. The old `anki_package::backup_database` is removed.
- **Restore sequence:** validate the backup (readable, a version this Atlas understands) →
  save a `pre-restore` copy of the current data → copy the backup beside the database → close the
  app's connection → rename the copy over `atlas.db` (removing stale `-wal` / `-shm`) → reopen.
  If anything fails before the rename, the current data is untouched and the connection is put
  back. If the reopen fails after the rename, Atlas says to restart and the `pre-restore` copy
  exists.

### TypeScript

- `src/platform/backupBridge.ts`: the adapter for the Rust commands (like `importBridge.ts`).
- `src/services/backupService.ts`: all the policy: is a daily backup due (by local calendar day),
  the before-delete throttle, the switch, the "is there anything to protect" check, last backup,
  restore (calling `migrate` afterwards, since an older backup needs upgrading).
- `AppDeps.backups` (optional, like `importer`): absent in tests and browser previews, where the
  steps simply do nothing.
- **Launch order:** back up before upgrading if an upgrade is pending → upgrade → recover
  interrupted imports → daily backup (in the background, after the screen is up).
- **Hooks:** `deleteDeck` caller (`DeckActions.tsx`) and `deleteNote` (via the study session)
  call the service first and stop if it fails.
- **Settings:** a third section "Backups", using the shared `Button`, `Toggle` and `Dialog`.
  Buttons are rounded rectangles, colours come from theme tokens. The restore list shows each
  backup's date, kind and size; restoring asks for confirmation, then reloads the app's data,
  clears Undo, and goes to the home screen.

## Errors the user sees (plain language)

- Delete: "Atlas couldn't make a safety backup first, so nothing was deleted. Check there's free
  space and try again."
- Upgrade: startup message naming the cause and saying the old data is untouched.
- Restore: "That backup can't be used" with the reason (unreadable, or made by a newer Atlas).

## Testing

- Rust: the `atlas-backup` crate's own tests (naming, piles and limits, temp-file handling,
  refusing bad names, inspect, restore helper) run anywhere.
- TypeScript: service policy (daily due logic across midnight, throttle, switch, failure
  behaviour, empty-database skip), with a fake backup port.
- UI: the Settings section (toggle saves, Back up now, last-backup text, restore confirmation).
- The real Windows app cannot run here; the final report lists what to try on the laptop.
