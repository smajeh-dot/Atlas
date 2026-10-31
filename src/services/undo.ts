import type { Statement } from '../data/db';

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

  get size(): number {
    return this.entries.length;
  }
}
