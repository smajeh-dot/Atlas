// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { sanitizeCardHtml } from '../../../src/ui/card/sanitize';

test.each([
  ['<script>alert(1)</script>Hi', 'Hi'],
  ['<img src="x.png" onerror="alert(1)">', '<img src="x.png">'],
  ['<iframe src="https://evil"></iframe>ok', 'ok'],
  ['<a href="javascript:alert(1)">t</a>', '<a>t</a>'],
  ['<a href="https://example.com">t</a>', '<a>t</a>'],
  ['<img src="https://remote/x.png">', '<img>'],
  ['<img src="//remote/x.png">', '<img>'],
  ['<img src="C:\\Users\\x.png">', '<img>'],
  ['<img src="../secret.png">', '<img>'],
  ['<img src="data:image/png;base64,AAAA">', '<img src="data:image/png;base64,AAAA">'],
  ['<img src="data:text/html;base64,AAAA">', '<img>'],
  ['<div style="background:url(https://x/y)">a</div>', '<div style="background:">a</div>'],
  ['<object data="x"></object><embed src="y"><form action="/x"><input name="a"></form>z', '<input>z'],
  ['<p onclick="steal()">p</p>', '<p>p</p>'],
])('sanitises %s', (input, out) => expect(sanitizeCardHtml(input)).toBe(out));

test('keeps the type-in box, cloze spans, hints and formatting', () => {
  const html = '<span class="cloze">[…]</span><input class="atlas-typein" data-field="Back"><details class="atlas-hint"><summary>Show hint</summary>h</details><b>b</b><sub>2</sub>';
  expect(sanitizeCardHtml(html)).toBe(html);
});
