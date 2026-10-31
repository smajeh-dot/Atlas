import { expect, test } from 'vitest';
import { cardOrdsForNote } from '../../src/core/cards';
import { BUILTIN_NOTE_TYPES } from '../../src/core/builtins';
import type { NoteType } from '../../src/core/model';

const type = (b: string): NoteType => ({ id: 1, ...BUILTIN_NOTE_TYPES.find((t) => t.builtin === b)! });

test('built-in note types', () => {
  expect(BUILTIN_NOTE_TYPES.map((t) => t.name)).toEqual(['Basic', 'Basic and reversed', 'Type the answer', 'Cloze']);
  expect(type('cloze').fields.map((f) => f.name)).toEqual(['Text', 'Extra']);
});

test('reversed makes card 2 only when the back is filled', () => {
  expect(cardOrdsForNote(type('basic_reversed'), ['Q', ''])).toEqual([0]);
  expect(cardOrdsForNote(type('basic_reversed'), ['Q', 'A'])).toEqual([0, 1]);
});

test('cloze makes one card per number', () => {
  expect(cardOrdsForNote(type('cloze'), ['{{c1::a}} {{c3::b}}', ''])).toEqual([0, 2]);
  expect(cardOrdsForNote(type('cloze'), ['no clozes', ''])).toEqual([]);
});

test('an empty front makes no cards', () => {
  expect(cardOrdsForNote(type('basic'), ['', 'A'])).toEqual([]);
  expect(cardOrdsForNote(type('basic'), ['<br>', 'A'])).toEqual([]);
});

test('a type-in box alone does not count as content', () => {
  expect(cardOrdsForNote(type('basic_typein'), ['', 'A'])).toEqual([]);
  expect(cardOrdsForNote(type('basic_typein'), ['Q', 'A'])).toEqual([0]);
});
