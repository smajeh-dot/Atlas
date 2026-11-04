import { expect, test } from 'vitest';
import { findMath } from '../../../src/core/math';
import { fromEditorHtml, toEditorHtml } from '../../../src/ui/editor/fieldHtml';

test.each([
  ['<p>Hello</p>', 'Hello'],
  ['<p>a</p><p>b</p>', 'a<br>b'],
  ['<p>a</p><p></p><p>b</p>', 'a<br><br>b'],
  ['<p></p>', ''],
  ['<p>x <span data-math="inline">a&lt;b</span></p>', 'x $a&lt;b$'],
  ['<p><span data-math="display">\\int f</span></p>', '$$\\int f$$'],
  ['<ul><li><p>one</p></li></ul>', '<ul><li><p>one</p></li></ul>'],
])('fromEditorHtml %s', (html, field) => expect(fromEditorHtml(html)).toBe(field));

test.each([
  // Whitespace around the TeX is trimmed rather than forcing the fallback.
  ['<p><span data-math="inline"> x </span></p>', '$x$'],
  // An inline equation followed by a digit would not close.
  ['<p><span data-math="inline">x</span>5</p>', '\\(x\\)5'],
  // An unescaped dollar inside would end the equation early.
  ['<p><span data-math="inline">a$b</span></p>', '\\(a$b\\)'],
  ['<p><span data-math="display">a$$b</span></p>', '\\[a$$b\\]'],
  // An escaped dollar is fine.
  ['<p><span data-math="inline">\\$5</span></p>', '$\\$5$'],
  // A trailing backslash would escape the closing dollar.
  ['<p><span data-math="inline">a\\</span></p>', '\\(a\\\\)'],
  // Neighbouring equations each come back as themselves.
  ['<p><span data-math="inline">a</span><span data-math="inline">b</span></p>', '$a$$b$'],
  ['<p><span data-math="inline">a</span><span data-math="display">b</span></p>', '$a$$$b$$'],
])('falls back to \\( \\) or \\[ \\] only when dollars would not read back: %s', (html, field) => expect(fromEditorHtml(html)).toBe(field));

test('toEditorHtml turns every delimiter into math spans', () => {
  expect(toEditorHtml('x \\(x^2\\) y')).toBe('x <span data-math="inline">x^2</span> y');
  expect(toEditorHtml('\\[E=mc^2\\]')).toBe('<span data-math="display">E=mc^2</span>');
  expect(toEditorHtml('x $x^2$ y')).toBe('x <span data-math="inline">x^2</span> y');
  expect(toEditorHtml('$$E=mc^2$$')).toBe('<span data-math="display">E=mc^2</span>');
  expect(toEditorHtml('$a&lt;b$')).toBe('<span data-math="inline">a&lt;b</span>');
  expect(toEditorHtml('It costs $5 and $10')).toBe('It costs $5 and $10');
});

test('toEditorHtml round-trips through fromEditorHtml', () => {
  for (const f of ['a<br>b', 'x $x^2$ y', '<b>bold</b> $$E=mc^2$$', '']) expect(fromEditorHtml(`<p>${toEditorHtml(f)}</p>`)).toBe(f);
});

const CORPUS = [
  '',
  'plain',
  'It costs $5 and $10.',
  '\\$x\\$ is not maths',
  '$x^2$',
  'Solve $x+1=2$ now',
  '$5 and $x$',
  '$a$$b$',
  '$$E=mc^2$$',
  'a<br>$$x$$<br>b',
  '$$a<br>b$$',
  '$$a&amp;b\\\\c$$',
  '$$a$b$$',
  '\\(x\\) $y$ \\[z\\]',
  '\\(\\$5\\)',
  '\\(x\\)5',
  '\\(a$b\\)',
  '\\[a$$b\\]',
  '$a&lt;b$ and $c &gt; d$',
  '<b>$x$</b> and <code>$y$</code>',
  '{{c1::$x^2$}} and $y = {{c2::5::hint}}$',
  '$\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$',
  '$x$$$y$$',
  '\\(  spaced  \\)',
];

const shape = (f: string) => findMath(f).map((m) => [m.kind, m.tex]);
const pass = (f: string) => fromEditorHtml(`<p>${toEditorHtml(f)}</p>`);

test.each(CORPUS)('editor round trip keeps the equations and settles after one pass: %s', (field) => {
  const once = pass(field);
  expect(pass(once)).toBe(once);
  expect(shape(once)).toEqual(shape(field));
});
