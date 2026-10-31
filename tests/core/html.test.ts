import { expect, test } from 'vitest';
import { stripHtml } from '../../src/core/html';

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
