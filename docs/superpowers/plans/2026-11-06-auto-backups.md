# Automatic Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atlas backs up `atlas.db` daily and before risky actions, and Settings can switch it off, back up now, show the last backup and restore one.

**Architecture:** File work is a new pure-Rust workspace crate `atlas-backup` (testable anywhere) behind three thin Tauri commands. Policy (when to back up, throttle, switch, restore-then-upgrade) is a TypeScript `BackupService` behind an optional `AppDeps.backups`, tested with a fake port. Backups use a second database connection so the app never freezes.

**Tech Stack:** Rust + rusqlite 0.37 (`VACUUM INTO`), Tauri 2, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-auto-backups-design.md`

## Global Constraints

- Files are named `<kind>-<epoch ms>.db` in `backups\`; kinds: `daily`, `manual`, `pre-delete`, `pre-import`, `pre-restore`, `pre-upgrade`.
- Piles and limits: daily 7; manual 10; safety (`pre-delete`, `pre-import`, `pre-restore`) 10; `pre-upgrade` 3.
- Switch (`autoBackup`) governs `daily` and `pre-delete` only. `manual`, `pre-import`, `pre-restore`, `pre-upgrade` always run.
- Before-delete throttle: at most one `pre-delete` per 10 minutes (10 * 60 * 1000 ms).
- No backup of a database with no notes (daily, before-delete skip it). Before-upgrade skips a brand-new database (schema version 0).
- Failure: before-delete and before-upgrade stop the action; daily fails silently.
- `CLAUDE.md`: buttons are rounded rectangles via the shared `Button` (never a pill); colours only from theme tokens (no literal colours, even in CSS comments); add only what is specified.
- Never delete a file in `backups\` that does not parse as a backup name.

## Review Focus

- Folder holds files Atlas did not make (user notes, `.tmp` leftovers): pruning and listing must ignore or only clean `.tmp`, never delete user files. (Task 1)
- Disk full or a failure mid-backup: no half-written file may remain under a real backup name. (Task 1)
- Restore of a corrupt, non-Atlas, or newer-version file, or a name with path separators: refused, current data untouched. (Task 2)
- Two backups in the same millisecond must not overwrite each other. (Task 1)
- Clock past midnight / switch off / empty database: daily runs once per local day, not when off, not when there are no notes. (Task 4)

## File Structure

- Create `src-tauri/crates/atlas-backup/{Cargo.toml,src/lib.rs,tests/backups.rs}`: naming, piles, create, list, clean temps, inspect, stage/finish restore.
- Create `src-tauri/src/backup.rs`: Tauri commands, backup/restore lock.
- Modify `src-tauri/Cargo.toml`, `src-tauri/src/{main.rs,import.rs}`, remove `backup_database` from `src-tauri/crates/anki-package/{src/install.rs,src/lib.rs,tests/install.rs}`.
- Create `src/platform/backupBridge.ts` (Tauri adapter), `src/services/backupService.ts` (policy), `tests/services/backupService.test.ts`.
- Modify `src/data/migrations.ts` (export `SCHEMA_VERSION`, `pendingUpgrade`), `src/services/undo.ts` (`clear`), `src/App.tsx`, `src/ui/app/AtlasContext.tsx`, `src/ui/screens/Today/DeckActions.tsx`, `src/services/studySession.ts` + `src/ui/screens/Study/Study.tsx`, `src/ui/screens/Settings/Settings.tsx`, `README.md`.
- Create `src/ui/screens/Settings/BackupSettings.tsx` (+ test `tests/ui/screens/settings.backups.test.tsx`).

### Task 1: `atlas-backup` crate: create, list, prune

**Files:** Create crate (above); add `"crates/atlas-backup"` to the workspace `members` in `src-tauri/Cargo.toml`.

**Interfaces — Produces:**
```rust
pub enum Kind { Daily, Manual, PreDelete, PreImport, PreRestore, PreUpgrade }
impl Kind { pub fn as_str(self) -> &'static str; pub fn parse(s: &str) -> Option<Kind>; pub fn limit(self) -> usize; }
pub struct BackupInfo { pub name: String, pub kind: Kind, pub created_at_ms: u64, pub size_bytes: u64 }
pub enum Error { Io(String), Invalid(String) }   // Display; Invalid = refused input
pub fn create(db_path: &Path, dir: &Path, kind: Kind, now_ms: u64) -> Result<BackupInfo, Error>;
pub fn list(dir: &Path) -> Result<Vec<BackupInfo>, Error>;     // newest first; ignores non-backup names
pub fn clean_temps(dir: &Path);                                 // removes only `*.tmp` backup leftovers
```

- [ ] **Step 1: Tests** in `tests/backups.rs` (real files in a temp dir, a small real SQLite db with a `notes` table): `create_makes_a_complete_copy_named_kind_and_stamp`; `create_leaves_no_tmp_file_and_no_partial_on_failure` (unwritable/nonexistent source path → `Err`, directory has no `.db` and no `.tmp`); `same_millisecond_twice_does_not_overwrite` (second gets stamp +1); `each_pile_keeps_only_its_limit_and_prunes_oldest` (8 daily → 7 remain, oldest gone; `pre-upgrade` keeps 3; `pre-delete`+`pre-import`+`pre-restore` share 10); `piles_do_not_evict_each_other` (11 safety copies leave all 7 daily); `files_that_are_not_backups_are_never_touched_or_listed` (`notes.txt`, `daily-abc.db`, `daily-123.db.bak` survive prune and are absent from `list`); `old_pre_import_files_still_parse`; `clean_temps_removes_only_tmp`; `list_is_newest_first`.
- [ ] **Step 2:** `cargo test -p atlas-backup --manifest-path src-tauri/Cargo.toml` → FAIL (crate missing).
- [ ] **Step 3: Implement.** `create` opens a second `rusqlite::Connection` (read-write, no create) on `db_path`, `VACUUM INTO '<dir>/<kind>-<ms>.db.tmp'`, renames to final name; on error removes the `.tmp`; bumps `now_ms` while the final name exists; then prunes the kind's pile. Parse names with `rsplit_once('-')` on the stem. Pile of a kind = the set of kinds sharing a limit (safety kinds share one).
- [ ] **Step 4:** run the crate tests → PASS.
- [ ] **Step 5: Commit** `feat(backup): backup crate with piles and pruning`.

### Task 2: `atlas-backup`: inspect and restore staging

**Interfaces — Consumes:** Task 1. **Produces:**
```rust
pub struct Inspected { pub schema_version: u32 }
pub fn inspect(path: &Path) -> Result<Inspected, Error>;   // read-only open, PRAGMA quick_check = "ok", has tables meta+notes+cards, reads meta schema_version
pub fn stage_restore(backups_dir: &Path, name: &str, db_path: &Path, max_version: u32) -> Result<PathBuf, Error>;
pub fn finish_restore(staged: &Path, db_path: &Path) -> Result<(), Error>;
```

- [ ] **Step 1: Tests:** `inspect_reads_the_schema_version`; `inspect_refuses_a_corrupt_file`; `inspect_refuses_a_non_atlas_database`; `stage_restore_refuses_a_newer_version` (`max_version` below file's); `stage_restore_refuses_names_with_path_separators_or_unknown_names` (`..\x.db`, `../x.db`, name not in `list`); `stage_restore_copies_to_restore_tmp_beside_the_database_and_leaves_current_data_untouched`; `finish_restore_replaces_the_database_and_removes_stale_wal_and_shm`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (`stage_restore` validates the name against `list`, inspects, copies to `<db_path>.restore.tmp`; `finish_restore` deletes `-wal`/`-shm` then `fs::rename`, which replaces on Windows). **Step 4:** PASS. **Step 5:** Commit `feat(backup): inspect and stage a restore`.

### Task 3: Tauri commands and import switch-over

**Files:** Create `src-tauri/src/backup.rs`; modify `src-tauri/{Cargo.toml,src/main.rs,src/import.rs}`; remove `backup_database` + its re-export + its test (`a_backup_is_a_complete_copy_of_the_database`) from `anki-package`.

**Interfaces — Produces (Tauri):**
`backup_create(kind: String) -> BackupDto`, `backup_list() -> Vec<BackupDto>`, `backup_restore(name: String, max_version: u32) -> ()` where `BackupDto { name, kind, createdAt, sizeBytes }` (camelCase JSON). A `BackupLock(Mutex<()>)` managed state serialises create and restore.

- [ ] **Step 1:** Write the commands: create/list via `spawn_blocking` on `atlas-backup` with `data_dir()`; restore = lock → `stage_restore` → `create(PreRestore)` → take the app connection out of `DbState` (`None`) → `finish_restore` → `db::open` and put it back (on `finish_restore` failure put the original back and return the error; on reopen failure leave a clear "restart Atlas" error).
- [ ] **Step 2:** `db_backup` (import) calls `atlas_backup::create(.., Kind::PreImport, ..)` and returns the path. `main.rs`: register commands, `.manage(BackupLock)`, call `atlas_backup::clean_temps` at start-up beside `clean_up_after_crash`.
- [ ] **Step 3: Verify:** `cargo test -p atlas-backup -p anki-package --manifest-path src-tauri/Cargo.toml` passes; `cargo check` of the app crate if the Tauri system libraries build here, otherwise state plainly in the final report that the app crate could not be compiled on this machine and was reviewed by hand.
- [ ] **Step 4: Commit** `feat(backup): Tauri commands; import uses the shared backup code`.

### Task 4: `BackupService` (policy) and migrations helper

**Interfaces — Produces:**
```ts
// src/data/migrations.ts
export const SCHEMA_VERSION: number;                         // MIGRATIONS.length
export async function pendingUpgrade(db: Db): Promise<{ from: number; to: number } | null>; // null when from === 0 (fresh) or from === to
// src/platform/backupBridge.ts
export type BackupKind = 'daily' | 'manual' | 'pre-delete' | 'pre-import' | 'pre-restore' | 'pre-upgrade';
export interface BackupInfo { name: string; kind: BackupKind; createdAt: number; sizeBytes: number }
export interface BackupPort { create(kind: BackupKind): Promise<BackupInfo>; list(): Promise<BackupInfo[]>; restore(name: string, maxVersion: number): Promise<void> }
export const tauriBackupPort: BackupPort;
// src/services/backupService.ts
export class SafetyBackupError extends Error {}   // message: "Atlas couldn't make a safety backup first, so nothing was changed. Check there's free space and try again."
export interface BackupService {
  ensureDaily(): Promise<void>;              // never throws
  beforeDelete(): Promise<void>;             // throws SafetyBackupError
  beforeUpgrade(): Promise<void>;            // throws SafetyBackupError; no-op unless pendingUpgrade
  backupNow(): Promise<BackupInfo>;
  list(): Promise<BackupInfo[]>;
  lastBackup(): Promise<BackupInfo | null>;
  restore(name: string): Promise<void>;      // port.restore(name, SCHEMA_VERSION) then migrate(db, now)
}
export function createBackupService(deps: { port: BackupPort; db: Db; clock: { now(): number } }): BackupService;
```
Also `UndoStack.clear(): void` in `src/services/undo.ts`.

- [ ] **Step 1: Tests** (`tests/services/backupService.test.ts`, fake port recording calls, `createMigratedDb`): `ensureDaily` makes one `daily` when none exists today, none when one exists for the same local calendar day, again after local midnight; skips when `autoBackup` is off; skips a database with no notes; swallows a port failure. `beforeDelete`: runs when on and has notes; skipped when off; second call within 10 minutes skipped, after 10 minutes runs; port failure → `SafetyBackupError`. `beforeUpgrade`: no-op for fresh and current databases; backs up `pre-upgrade` when `pendingUpgrade` is set (database migrated to v1, target v2); failure → `SafetyBackupError`. `backupNow` ignores the switch. `lastBackup` returns newest of any kind or null. `restore` calls the port with `SCHEMA_VERSION` then leaves the database at `SCHEMA_VERSION`. `pendingUpgrade` cases in `tests/data/migrations.test.ts`.
- [ ] **Step 2:** `npx vitest run tests/services/backupService.test.ts` → FAIL. **Step 3:** implement. Throttle uses `list()` (newest `pre-delete` time), not in-memory state. **Step 4:** PASS + `npm run typecheck`. **Step 5:** Commit `feat(backup): backup service and policy`.

### Task 5: Wire into launch and delete actions

**Files:** `src/App.tsx`, `src/ui/app/AtlasContext.tsx` (`AppDeps.backups?: BackupService`), `src/ui/screens/Today/DeckActions.tsx`, `src/services/studySession.ts` (`SessionDeps.backups?`) + the place `Study.tsx` builds the session deps.

- [ ] **Step 1: Tests:** in `tests/services/deckService.test.ts` style or a new `tests/ui/deleteBackups.test.tsx`: deleting a deck calls `backups.beforeDelete` before the delete and a rejecting `beforeDelete` leaves the deck in place and shows the error; `StudySession.deleteCurrentNote` likewise (note remains, error surfaces). Existing tests (no `backups`) stay green.
- [ ] **Step 2:** FAIL. **Step 3:** In `start()`: build the service; `await backups.beforeUpgrade()` before `migrate` (a `SafetyBackupError` becomes the startup error text, old data untouched); after the app is ready fire `void backups.ensureDaily()` (not awaited). `DeckActions` and the session call `await backups?.beforeDelete()` first; failures use the existing `failed()` toast / error path with the `SafetyBackupError` message. **Step 4:** `npm test` all green. **Step 5:** Commit `feat(backup): back up on launch and before deletes`.

### Task 6: Settings → Backups

**Files:** Create `src/ui/screens/Settings/BackupSettings.tsx`; modify `Settings.tsx` (new section `backups`, label "Backups"), `AtlasContext.tsx` (`Route` settings section union adds `'backups'`).

- [ ] **Step 1: Tests** (`tests/ui/screens/settings.backups.test.tsx`, fake `BackupService` in deps): shows "Automatic backups" toggle bound to `settings.autoBackup` and saves on change; shows "Last backup: <date>" or "No backups yet"; **Back up now** calls `backupNow` and refreshes the date, shows an error toast on failure; the list shows date, label and size per backup (labels: Daily, Back up now, Before a delete, Before an import, Before a restore, Before an upgrade); **Restore** opens a confirm Dialog naming the date and saying a copy of current cards is saved first; confirming calls `restore`, clears Undo, bumps `changed()`, navigates to Today and toasts "Restored"; a rejected restore shows "That backup can't be used" with the reason and changes nothing; with no `backups` dep the section explains backups are unavailable in this preview.
- [ ] **Step 2:** FAIL. **Step 3:** implement with shared `Button`, `Toggle`, `Dialog`, `useToast`; add classes to `Settings.module.css` using existing tokens only. **Step 4:** PASS, `npm run typecheck`, and `npx vitest run tests/ui/noLiteralColours.test.ts`. **Step 5:** Commit `feat(backup): Backups section in Settings with restore`.

### Task 7: README and final verification

- [ ] **Step 1:** Rewrite "Your data" in `README.md`: list `backups\` kinds and limits in plain words, the Settings → Backups page, restore in-app (delete the File Explorer recipe, keep a one-line manual note), what is not backed up (`media\`), and that copies on the same computer don't survive a lost drive (keep a copy elsewhere).
- [ ] **Step 2:** Run everything: `npm run typecheck`, `npm test`, `cargo test -p atlas-backup -p anki-package --manifest-path src-tauri/Cargo.toml`. Expected: all pass.
- [ ] **Step 3:** Spec coverage self-check against the spec's Scope and Decisions tables; fix gaps. **Step 4:** Commit `docs: describe automatic backups in the README`, push `auto-backups-feature` with `git push -u origin auto-backups-feature`.
