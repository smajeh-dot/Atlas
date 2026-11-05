import { describe, expect, test } from 'vitest';
import { extractMath, findMath, hasDisplayMath, hasMath, texText } from '../../src/core/math';

const spans = (html: string) => findMath(html).map((s) => [s.kind, s.tex]);
const placeholder = (kind: 'inline' | 'display', tex: string) =>
  kind === 'display'
    ? `<span class="atlas-math atlas-math-display" data-display="1" data-tex="${encodeURIComponent(tex)}"></span>`
    : `<span class="atlas-math" data-display="0" data-tex="${encodeURIComponent(tex)}"></span>`;

describe('inline $…$', () => {
  test.each([
    ['$x^2$', 'x^2'],
    ['Solve $x+1=2$ now', 'x+1=2'],
    ['$\\frac{a}{b}$', '\\frac{a}{b}'],
    ['$_2$', '_2'],
    ['$a&lt;b$', 'a<b'],
  ])('%s', (html, tex) => expect(spans(html)).toEqual([['inline', tex]]));
});

describe('literal dollars (no maths)', () => {
  test.each([
    ['It costs $5 and $10.', 'currency'],
    ['$5', 'lone dollar'],
    ['$ x $', 'spaces'],
    ['$&nbsp;x$', '&nbsp; after opener'],
    ['$x&nbsp;$', '&nbsp; before closer'],
    ['$x$5', 'digit after closer'],
    ['a $b', 'unmatched'],
    ['$a<br>b$', 'break inside inline'],
    ['$a<div>b</div>$', 'block tag inside inline'],
    ['$a\nb$', 'newline inside inline'],
    ['<code>$x$</code>', 'inside code'],
    ['<pre>$$x$$</pre>', 'inside pre'],
    ['<img alt="$x$" src="a.png">', 'inside attribute'],
    ['<!-- $x$ -->', 'inside a comment'],
    ['$$$$', 'empty block'],
    ['$$ $$', 'empty block'],
    ['$$x', 'unmatched block'],
    ['\\$x\\$', 'escaped'],
  ])('%s (%s)', (html) => expect(spans(html)).toEqual([]));

  test('escaped dollars render as plain dollars', () => {
    expect(extractMath('\\$x\\$')).toBe('$x$');
    expect(extractMath('costs \\$5 and $y$')).toBe(`costs $5 and ${placeholder('inline', 'y')}`);
  });

  test('literal text comes back unchanged', () => {
    for (const html of ['It costs $5 and $10.', '<code>\\$x</code>', '$$x', '<img alt="$x$" src="a.png">']) expect(extractMath(html)).toBe(html);
  });
});

describe('special cases', () => {
  test('a currency dollar before an equation does not swallow it', () => {
    expect(spans('$5 and $x$')).toEqual([['inline', 'x']]);
  });

  test('two touching inline equations', () => {
    expect(spans('$a$$b$')).toEqual([['inline', 'a'], ['inline', 'b']]);
  });
});

describe('display $$…$$', () => {
  test.each([
    ['$$E=mc^2$$', [['display', 'E=mc^2']]],
    ['a $$x$$ b', [['display', 'x']]],
    ['$$a<br>b$$', [['display', 'a\nb']]],
    ['<br>$$x$$<br>', [['display', 'x']]],
    ['<div>$$x$$</div>', [['display', 'x']]],
    ['$$a&amp;b\\\\c$$', [['display', 'a&b\\\\c']]],
    ['$$a$b$$', [['display', 'a$b']]],
    ['$x$ and $$y$$', [['inline', 'x'], ['display', 'y']]],
    ['$$\\begin{aligned}a&amp;=b\\\\c&amp;=d\\end{aligned}$$', [['display', '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}']]],
  ])('%s', (html, out) => expect(spans(html)).toEqual(out));

  test('one line break is dropped on each side', () => {
    expect(extractMath('a<br>$$x$$<br>b')).toBe(`a${placeholder('display', 'x')}b`);
    expect(extractMath('a<br><br> $$x$$ <br><br>b')).toBe(`a<br>${placeholder('display', 'x')}<br>b`);
    expect(extractMath('a $$x$$ b')).toBe(`a ${placeholder('display', 'x')} b`);
  });

  test('tags inside are dropped, entities decoded, whitespace trimmed', () => {
    expect(spans('$$ <b>x</b>&nbsp;+&#121;&#x7a; $$')).toEqual([['display', 'x +yz']]);
    expect(spans('$$\\alpha<div>b</div>$$')).toEqual([['display', '\\alpha\nb']]);
  });
});

describe('Anki delimiters', () => {
  test('mixed forms', () => {
    expect(spans('\\(x\\) $y$ \\[z\\]')).toEqual([['inline', 'x'], ['inline', 'y'], ['display', 'z']]);
  });

  test('an escaped dollar inside \\( \\) is TeX and left alone', () => {
    expect(spans('\\(\\$5\\)')).toEqual([['inline', '\\$5']]);
  });

  test('\\[ \\] may span lines', () => {
    expect(spans('\\[a<br>b\\]')).toEqual([['display', 'a\nb']]);
  });

  test('positions point into the original HTML', () => {
    const html = 'Q: \\(x\\) and $$y$$';
    const [a, b] = findMath(html);
    expect(html.slice(a!.start, a!.end)).toBe('\\(x\\)');
    expect(html.slice(a!.bodyStart, a!.bodyEnd)).toBe('x');
    expect(html.slice(b!.start, b!.end)).toBe('$$y$$');
    expect(html.slice(b!.bodyStart, b!.bodyEnd)).toBe('y');
  });
});

test('placeholders keep the TeX encoded so markup-like TeX survives', () => {
  expect(extractMath('$[A]&gt;0$')).toBe(placeholder('inline', '[A]>0'));
  expect(extractMath('$"a"$')).toContain('data-tex="%22a%22"');
});

test('hasMath and hasDisplayMath', () => {
  expect(hasMath('What is $\\pi$?')).toBe(true);
  expect(hasMath('It costs $5')).toBe(false);
  expect(hasDisplayMath('What is $\\pi$?')).toBe(false);
  expect(hasDisplayMath('$$x$$')).toBe(true);
  expect(hasDisplayMath('\\[x\\]')).toBe(true);
  expect(hasDisplayMath('<code>\\[x\\]</code>')).toBe(false);
});

test('texText escapes characters that are special in \\text{}', () => {
  expect(texText('a_b}c{d$e&f#g%h^i~j\\k')).toBe(
    'a\\_b\\}c\\{d\\$e\\&f\\#g\\%h\\textasciicircum{}i\\textasciitilde{}j\\textbackslash{}k',
  );
  expect(texText('plain words')).toBe('plain words');
});
