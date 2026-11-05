import { expect, test } from 'vitest';
import { isShortHtml, stripHtml } from '../../src/core/html';

test('removes tags without adding spaces inside words', () => {
  expect(stripHtml('<b>H</b><sub>2</sub>O')).toBe('H2O');
});

test('line breaks and blocks become spaces', () => {
  expect(stripHtml('a<br>b<div>c</div>')).toBe('a b c');
});

test('decodes common entities and trims', () => {
  expect(stripHtml('Tom &amp; Jerry&nbsp;')).toBe('Tom & Jerry');
  expect(stripHtml('&lt;x&gt; &quot;q&quot; &#39;s&#39;')).toBe('<x> "q" \'s\'');
});

test('isShortHtml', () => {
  expect(isShortHtml('What is osmosis?', 140)).toBe(true);
  expect(isShortHtml('<b>bold</b> is fine', 140)).toBe(true);
  expect(isShortHtml('<img src="a.png">', 140)).toBe(false);
  expect(isShortHtml('a<br>b', 140)).toBe(false);
  expect(isShortHtml('<div>a</div>', 140)).toBe(false);
  expect(isShortHtml('\\[x^2\\]', 140)).toBe(false);
  expect(isShortHtml('x'.repeat(61), 60)).toBe(false);
  expect(isShortHtml('x'.repeat(60), 60)).toBe(true);
});

test('isShortHtml with equations', () => {
  expect(isShortHtml('$$x$$', 140)).toBe(false);
  expect(isShortHtml('What is $\\pi$?', 140)).toBe(true);
  expect(isShortHtml('\\(x\\) is fine', 140)).toBe(true);
  expect(isShortHtml('<code>\\[x\\]</code>', 140)).toBe(true);
  // Each inline equation counts as 6 characters, however long its TeX.
  expect(isShortHtml(`Find $${'\\alpha+'.repeat(20)}1$`, 12)).toBe(true);
  expect(isShortHtml('Find $x$ $y$', 12)).toBe(false);
  // Currency is ordinary text.
  expect(isShortHtml(`Costs $5 and $${'1'.repeat(10)}`, 12)).toBe(false);
});
