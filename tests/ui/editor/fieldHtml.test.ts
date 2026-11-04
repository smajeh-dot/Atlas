import { expect, test } from 'vitest';
import { fromEditorHtml, toEditorHtml } from '../../../src/ui/editor/fieldHtml';

test.each([
  ['<p>Hello</p>', 'Hello'],
  ['<p>a</p><p>b</p>', 'a<br>b'],
  ['<p>a</p><p></p><p>b</p>', 'a<br><br>b'],
  ['<p></p>', ''],
  ['<p>x <span data-math="inline">a&lt;b</span></p>', 'x \\(a&lt;b\\)'],
  ['<p><span data-math="display">\\int f</span></p>', '\\[\\int f\\]'],
  ['<ul><li><p>one</p></li></ul>', '<ul><li><p>one</p></li></ul>'],
])('fromEditorHtml %s', (html, field) => expect(fromEditorHtml(html)).toBe(field));

test('toEditorHtml turns delimiters into math spans', () => {
  expect(toEditorHtml('x \\(x^2\\) y')).toBe('x <span data-math="inline">x^2</span> y');
  expect(toEditorHtml('\\[E=mc^2\\]')).toBe('<span data-math="display">E=mc^2</span>');
});

test('toEditorHtml round-trips through fromEditorHtml', () => {
  for (const f of ['a<br>b', 'x \\(x^2\\) y', '<b>bold</b> \\[E=mc^2\\]', '']) expect(fromEditorHtml(`<p>${toEditorHtml(f)}</p>`)).toBe(f);
});
