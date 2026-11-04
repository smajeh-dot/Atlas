/**
 * What an import did, in words a student can act on. Warnings are counted
 * and keep a few examples rather than listing every note.
 */

export type WarningCode =
  | 'no-scheduling'
  | 'unknown-filter'
  | 'image-occlusion'
  | 'sound'
  | 'latex'
  | 'active-content'
  | 'missing-media'
  | 'renamed-media'
  | 'renamed-deck'
  | 'renamed-note-type'
  | 'renamed-tags'
  | 'field-count'
  | 'filtered-deck';

export interface ImportWarning {
  code: WarningCode;
  message: string;
  count: number;
  examples: string[];
}

export interface ImportCounts {
  decks: number;
  notes: number;
  cards: number;
  reviews: number;
  media: number;
}

export interface ImportReport {
  sourceFormat: string;
  imported: ImportCounts;
  skipped: { existingNotes: number; cardsWithNoContent: number; reviewsForSkippedCards: number };
  /** Existing notes whose text was updated (only with the "update notes" option). */
  updatedNotes: number;
  /** Cards whose memory state was estimated from Anki's interval and ease (no history to replay). */
  estimated: number;
  /** Cards whose history alone would have scheduled them differently; Anki's dates were kept. */
  diverged: number;
  warnings: ImportWarning[];
  durationMs: number;
}

const MAX_EXAMPLES = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function message(code: WarningCode, n: number): string {
  switch (code) {
    case 'no-scheduling':
      return 'This file has no review history, so every card starts as new. If you meant to keep your progress, export again from Anki with "Include scheduling information" ticked.';
    case 'unknown-filter':
      return `${plural(n, 'note type')} use template features Atlas can't show yet, so part of those cards may be blank.`;
    case 'image-occlusion':
      return `${plural(n, 'Image Occlusion note')} were imported with their history, but Atlas can't draw the masks yet.`;
    case 'sound':
      return `${plural(n, 'note')} have sound. Atlas can't play it yet; the files are kept for when it can.`;
    case 'latex':
      return `${plural(n, 'note')} use LaTeX maths, which Atlas can't display yet.`;
    case 'active-content':
      return `${plural(n, 'note')} contain scripts or embedded content. Atlas will never run them.`;
    case 'missing-media':
      return `${plural(n, 'picture or sound file')} mentioned in notes weren't in the file. Those parts of the cards will be empty.`;
    case 'renamed-media':
      return `${plural(n, 'media file')} were renamed so they don't overwrite different files with the same name. Your notes were updated to match.`;
    case 'renamed-deck':
      return `${plural(n, 'deck')} were renamed because Atlas couldn't use the original name.`;
    case 'renamed-note-type':
      return `${plural(n, 'note type')} were renamed because you already have a different note type with that name.`;
    case 'renamed-tags':
      return `${plural(n, 'note')} had tags tidied up (spaces become underscores, and tags differing only in capitals are merged).`;
    case 'field-count':
      return `${plural(n, 'note')} had a different number of fields from their note type and were padded or trimmed to fit.`;
    case 'filtered-deck':
      return `${plural(n, 'filtered deck')} weren't created. Their cards went back to their own decks, keeping their schedule.`;
  }
}

export class ReportBuilder {
  private readonly warnings = new Map<WarningCode, { count: number; examples: string[] }>();
  readonly imported: ImportCounts = { decks: 0, notes: 0, cards: 0, reviews: 0, media: 0 };
  readonly skipped = { existingNotes: 0, cardsWithNoContent: 0, reviewsForSkippedCards: 0 };
  updatedNotes = 0;
  estimated = 0;
  diverged = 0;

  warn(code: WarningCode, example?: string, by = 1): void {
    const w = this.warnings.get(code) ?? { count: 0, examples: [] };
    w.count += by;
    if (example !== undefined && w.examples.length < MAX_EXAMPLES && !w.examples.includes(example)) {
      w.examples.push(example);
    }
    this.warnings.set(code, w);
  }

  has(code: WarningCode): boolean {
    return this.warnings.has(code);
  }

  build(sourceFormat: string, durationMs: number): ImportReport {
    return {
      sourceFormat,
      imported: { ...this.imported },
      skipped: { ...this.skipped },
      updatedNotes: this.updatedNotes,
      estimated: this.estimated,
      diverged: this.diverged,
      warnings: [...this.warnings].map(([code, w]) => ({
        code,
        message: message(code, w.count),
        count: w.count,
        examples: w.examples,
      })),
      durationMs,
    };
  }
}
