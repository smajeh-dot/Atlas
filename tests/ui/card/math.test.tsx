// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { renderCloze } from '../../../src/core/cloze';
import { CardView } from '../../../src/ui/components/CardView';

const mediaUrl = (n: string) => `media://${n}`;

function shadow(html: string): ShadowRoot {
  const { container } = render(<CardView html={html} mediaUrl={mediaUrl} />);
  return container.querySelector('[data-cardview]')!.shadowRoot!;
}

const card = (root: ShadowRoot) => root.querySelector('.atlas-card')!;

describe('rendering', () => {
  test('inline and display equations in every syntax', () => {
    const root = shadow('$a$ and \\(b\\), then $$c$$ and \\[d\\]');
    expect(root.querySelectorAll('.katex')).toHaveLength(4);
    expect(root.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(root.querySelectorAll('.atlas-math-display .katex-display')).toHaveLength(2);
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  test('currency stays text and \\$ shows a dollar', () => {
    const root = shadow('It costs $5 and $10, or \\$20.');
    expect(root.querySelector('.katex')).toBeNull();
    expect(card(root).textContent).toBe('It costs $5 and $10, or $20.');
  });

  test('aligned equations keep their ampersands', () => {
    const root = shadow('$$\\begin{aligned}a&amp;=b\\\\c&amp;=d\\end{aligned}$$');
    expect(root.querySelector('.katex-error')).toBeNull();
    expect(root.querySelector('.katex-display')).not.toBeNull();
  });

  test('bad TeX shows an error span instead of crashing', () => {
    const root = shadow('before $\\frac{a$ after');
    // "$\frac{a$" is a valid span with broken TeX.
    expect(root.querySelector('.katex-error')).not.toBeNull();
    expect(card(root).textContent).toContain('before');
    expect(card(root).textContent).toContain('after');
  });

  test('chemistry with mhchem', () => {
    const root = shadow('$\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$ and $\\ce{A <--> B}$');
    expect(root.querySelectorAll('.katex')).toHaveLength(2);
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  test('TeX that looks like markup still renders', () => {
    const root = shadow('$[A]&gt;0$');
    expect(root.querySelector('.katex')).not.toBeNull();
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  test('the shortcut macros work and \\gdef cannot leak into the next card', () => {
    shadow('$\\gdef\\R{BAD}\\R$');
    const root = shadow('$\\R$');
    expect(root.querySelector('.mathbb')).not.toBeNull();
    expect(card(root).textContent).not.toContain('BAD');
  });

  test('equations in an answer region render too', () => {
    const { container } = render(<CardView html="Q $x$" answer="$$y$$" mediaUrl={mediaUrl} />);
    const root = container.querySelector('[data-cardview]')!.shadowRoot!;
    expect(root.querySelector('.atlas-question .katex')).not.toBeNull();
    expect(root.querySelector('.atlas-answer .katex-display')).not.toBeNull();
  });
});

describe('clozes', () => {
  test('a cloze inside an equation', () => {
    const front = shadow(renderCloze('$x = {{c1::5}}$', 1, 'front'));
    const hidden = front.querySelector('.katex .cloze')!;
    expect(hidden.textContent).toBe('[…]');
    expect(front.querySelector('.katex-error')).toBeNull();
    const back = shadow(renderCloze('$x = {{c1::5}}$', 1, 'back'));
    expect(back.querySelector('.katex .cloze')!.textContent).toBe('5');
  });

  test('a hint inside an equation', () => {
    const front = shadow(renderCloze('$x = {{c1::5::value}}$', 1, 'front'));
    expect(front.querySelector('.katex .cloze')!.textContent).toBe('[value]');
  });

  test('a hint with TeX-special characters', () => {
    const front = shadow(renderCloze('$x = {{c1::5::a_b}c &amp; 50%}}$', 1, 'front'));
    expect(front.querySelector('.katex-error')).toBeNull();
    expect(front.querySelector('.katex .cloze')!.textContent!.replace(/\u00a0/g, ' ')).toBe('[a_b}c & 50%]');
  });

  test('an inactive cloze inside an equation shows the plain answer', () => {
    const root = shadow(renderCloze('$x = {{c1::5}}$ {{c2::y}}', 2, 'front'));
    expect(root.querySelector('.katex .cloze')).toBeNull();
    expect(root.querySelector('.katex')!.textContent).toContain('5');
  });

  test('a cloze around a whole equation', () => {
    const front = shadow(renderCloze('{{c1::$x^2$}}', 1, 'front'));
    expect(front.querySelector('.katex')).toBeNull();
    expect(front.querySelector('.cloze')!.textContent).toBe('[…]');
    const back = shadow(renderCloze('{{c1::$e^{x^{2}}$}}', 1, 'back'));
    expect(back.querySelector('.cloze .katex')).not.toBeNull();
    expect(back.querySelector('.katex-error')).toBeNull();
  });
});

describe('security', () => {
  test.each([
    '\\href{javascript:alert(1)}{x}',
    '\\url{javascript:alert(1)}',
    '\\includegraphics{http://x/y.png}',
    '\\htmlStyle{color:red;background:url(http://x)}{x}',
    '\\htmlData{foo=bar}{x}',
    '\\htmlId{pwn}{x}',
    '\\htmlClass{pwn}{x}',
  ])('%s is not trusted', (tex) => {
    const root = shadow(`$${tex}$ and $$${tex}$$`);
    expect(root.querySelector('a, img, [href], [src], [data-foo], #pwn, .pwn')).toBeNull();
    // The rejected command is shown as error text; what matters is that no attribute carries it.
    const attrs = [...card(root).querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => `${a.name}=${a.value}`));
    expect(attrs.filter((a) => /red|url\(|javascript:|foo|pwn/.test(a) && !a.startsWith('data-tex='))).toEqual([]);
    // KaTeX draws a rejected command as its name in the error colour.
    expect(root.querySelector('.katex-html [style*="var(--danger)"]')).not.toBeNull();
  });

  test('a recursive macro stops quickly with an error', () => {
    const start = performance.now();
    const root = shadow('$\\def\\a{\\a\\a}\\a$');
    expect(root.querySelector('.katex-error')).not.toBeNull();
    expect(performance.now() - start).toBeLessThan(2000);
  });

  test('a forged placeholder is rendered as ordinary, untrusted TeX', () => {
    const tex = encodeURIComponent('\\href{javascript:alert(1)}{x}');
    const root = shadow(`<span class="atlas-math" data-tex="${tex}"><img src="a.png" onerror="alert(1)"></span><span class="atlas-math" data-tex="%E0%A4%A"></span>`);
    expect(root.querySelector('a, img, [onerror]')).toBeNull();
  });
});
