/**
 * The steps of importing an Anki file, independent of React and Tauri so it
 * can be tested: choose a file → read it → preview → import with progress and
 * Cancel → report. Exactly one step is current; the screen just draws it.
 */
import type { Db } from '../data/db';
import { ImportCancelled, previewImport, runImport, type ImportPlatform, type ImportPreview, type ImportProgress } from '../import/commit';
import type { ImportReport } from '../import/report';
import type { StagingSource } from '../import/staging';

export type ImportStep =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'preview'; fileName: string; preview: ImportPreview }
  | { kind: 'importing'; fileName: string; progress: ImportProgress; cancelling: boolean }
  | { kind: 'done'; fileName: string; report: ImportReport }
  | { kind: 'failed'; fileName: string | null; message: string; cancelled: boolean };

export interface ImportFlowDeps {
  db: Db;
  staging: StagingSource;
  platform: ImportPlatform;
  clock: { now(): number };
  chooseFile(): Promise<string | null>;
  /** Reads the file into the work folder; throws an Error with a student-facing message if it can't. */
  prepare(path: string): Promise<unknown>;
  /** Closes the prepared file and removes the work folder. */
  finish(): Promise<void>;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const message = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'Something went wrong while importing. Nothing was changed.';

export class ImportFlow {
  private current: ImportStep = { kind: 'idle' };
  private abort: AbortController | null = null;

  constructor(
    private readonly deps: ImportFlowDeps,
    private readonly onChange: (step: ImportStep) => void,
  ) {}

  get step(): ImportStep {
    return this.current;
  }

  /** True while the rest of Atlas must stay locked. */
  get busy(): boolean {
    return this.current.kind === 'reading' || this.current.kind === 'importing';
  }

  private set(step: ImportStep): void {
    this.current = step;
    this.onChange(step);
  }

  /** Asks for a file, reads it and shows what importing it would do. */
  async choose(): Promise<void> {
    if (this.busy) return;
    const path = await this.deps.chooseFile();
    if (!path) return;
    const name = fileName(path);
    this.set({ kind: 'reading', fileName: name });
    try {
      await this.deps.prepare(path);
      const preview = await previewImport(this.deps.db, this.deps.staging, this.deps.clock.now());
      this.set({ kind: 'preview', fileName: name, preview });
    } catch (e) {
      await this.deps.finish().catch(() => {});
      this.set({ kind: 'failed', fileName: name, message: message(e), cancelled: false });
    }
  }

  async start(options: { updateExisting: boolean } = { updateExisting: false }): Promise<void> {
    if (this.current.kind !== 'preview') return;
    const name = this.current.fileName;
    this.abort = new AbortController();
    this.set({ kind: 'importing', fileName: name, progress: { stage: 'backup', done: 0, total: 1 }, cancelling: false });
    try {
      const report = await runImport(this.deps.db, this.deps.staging, this.deps.platform, {
        sourceName: name,
        clock: this.deps.clock,
        updateExisting: options.updateExisting,
        signal: this.abort.signal,
        onProgress: (progress) => {
          if (this.current.kind === 'importing') this.set({ ...this.current, progress });
        },
      });
      this.set({ kind: 'done', fileName: name, report });
    } catch (e) {
      this.set({ kind: 'failed', fileName: name, message: message(e), cancelled: e instanceof ImportCancelled });
    } finally {
      this.abort = null;
      await this.deps.finish().catch(() => {});
    }
  }

  /** Stops the import at the end of the current chunk; everything it wrote is undone. */
  cancel(): void {
    if (this.current.kind !== 'importing' || !this.abort) return;
    this.abort.abort();
    this.set({ ...this.current, cancelling: true });
  }

  /** Back to the start; discards a preview without importing. */
  async close(): Promise<void> {
    if (this.busy) return;
    if (this.current.kind === 'preview') await this.deps.finish().catch(() => {});
    this.set({ kind: 'idle' });
  }
}
