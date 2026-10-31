import { expect, test } from 'vitest';
import { ANSWER_MARKER, renderCard, renderTemplate, type TemplateContext } from '../../src/core/templates';
import { BUILTIN_NOTE_TYPES } from '../../src/core/builtins';
import type { Note, NoteType } from '../../src/core/model';

const ctx = (fields: Record<string, string>, extra: Partial<TemplateContext> = {}): TemplateContext => ({
  fields, tags: ['paper-1', 'organic'], deckName: 'Chemistry::Organic', subdeckName: 'Organic',
  cardName: 'Card 1', noteTypeName: 'Basic', side: 'front', ...extra,
});
const type = (b: string, id = 1): NoteType => ({ id, ...BUILTIN_NOTE_TYPES.find((t) => t.builtin === b)! });
const note = (fields: string[], noteTypeId = 1): Note => ({
  id: 1, guid: 'g', noteTypeId, fields, sortField: '', tags: ['paper-1'], createdAt: 0, updatedAt: 0,
});

test('substitutes fields and special tags', () => {
  expect(renderTemplate('{{Front}} | {{Tags}} | {{Deck}} | {{Subdeck}} | {{Card}} | {{Type}}', ctx({ Front: 'Q' })).html)
    .toBe('Q | paper-1 organic | Chemistry::Organic | Organic | Card 1 | Basic');
});

test('unknown fields render empty', () => {
  expect(renderTemplate('[{{Nope}}]', ctx({})).html).toBe('[]');
});

test('conditional sections', () => {
  expect(renderTemplate('{{#Extra}}E: {{Extra}}{{/Extra}}', ctx({ Extra: '' })).html).toBe('');
  expect(renderTemplate('{{#Extra}}E: {{Extra}}{{/Extra}}', ctx({ Extra: 'x' })).html).toBe('E: x');
  expect(renderTemplate('{{^Extra}}none{{/Extra}}', ctx({ Extra: '' })).html).toBe('none');
  expect(renderTemplate('{{#Extra}}x{{/Extra}}', ctx({ Extra: '<br>' })).html).toBe('');
});

test('text, hint and unknown filters', () => {
  expect(renderTemplate('{{text:Front}}', ctx({ Front: '<b>bold</b>' })).html).toBe('bold');
  expect(renderTemplate('{{hint:Front}}', ctx({ Front: 'h' })).html)
    .toBe('<details class="atlas-hint"><summary>Show hint</summary>h</details>');
  expect(renderTemplate('{{foo:Front}}', ctx({ Front: 'x' }))).toEqual({ html: 'x', unknownFilters: ['foo'] });
});

test('type filter becomes an input on the front and a result slot on the back', () => {
  expect(renderTemplate('{{type:Back}}', ctx({ Back: 'a' })).html).toBe('<input class="atlas-typein" data-field="Back">');
  expect(renderTemplate('{{type:Back}}', ctx({ Back: 'a' }, { side: 'back' })).html)
    .toBe('<div class="atlas-typein-result" data-field="Back"></div>');
});

test('Basic card: answer is the question, the answer marker, then the back', () => {
  const r = renderCard(type('basic'), note(['What is 2+2?', '4']), 0, 'Maths');
  expect(r.question).toBe('What is 2+2?');
  expect(r.answer).toBe(`What is 2+2?${ANSWER_MARKER}4`);
});

test('reversed card 2 asks the back', () => {
  const r = renderCard(type('basic_reversed'), note(['dog', 'chien']), 1, 'French');
  expect(r.question).toBe('chien');
  expect(r.answer).toBe(`chien${ANSWER_MARKER}dog`);
});

test('cloze card uses the ord as the cloze number', () => {
  const r = renderCard(type('cloze'), note(['{{c1::a}} {{c2::b}}', 'extra']), 1, 'D');
  expect(r.question).toBe('a <span class="cloze">[…]</span>');
  expect(r.answer).toBe(`a <span class="cloze">b</span>${ANSWER_MARKER}extra`);
});
