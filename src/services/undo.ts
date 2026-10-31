import type { Db, Statement } from '../data/db';

export interface UndoEntry {
  label: string;
  /** Statements that put the database back as it was, run in one transaction. */
  restore: Statement[];
  /** The card to show again after undoing an answer. */
  cardId?: number;
}

const LIMIT = 30;

export class UndoStack {
  private entries: UndoEntry[] = [];

  push(e: UndoEntry): void {
    this.entries.push(e);
    if (this.entries.length > LIMIT) this.entries.shift();
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }

  peek(): UndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Undoes the most recent action outside a study session. Returns its label, or null when there is nothing to undo. */
export async function undoLast(db: Db, undo: UndoStack): Promise<string | null> {
  const entry = undo.pop();
  if (!entry) return null;
  await db.batch(entry.restore);
  return entry.label;
}
