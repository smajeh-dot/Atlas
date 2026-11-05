import { describe, expect, test } from 'vitest';
import { clozeNumbers, nextClozeNumber, renderCloze } from '../../src/core/cloze';
import { findMath } from '../../src/core/math';

test('finds distinct cloze numbers in order, including two digits', () => {
  expect(clozeNumbers('{{c1::a}} {{c2::b}} {{c1::c}} {{c10::d}}')).toEqual([1, 2, 10]);
});

test('hides the active cloze on the front and shows it on the back', () => {
  expect(renderCloze('{{c1::<b>H₂O</b>}} is water', 1, 'front')).toBe('<span class="cloze">[…]</span> is water');
  expect(renderCloze('{{c1::<b>H₂O</b>}} is water', 1, 'back')).toBe('<span class="cloze"><b>H₂O</b></span> is water');
});

test('a hint replaces the dots and may contain colons', () => {
  expect(renderCloze('{{c1::Paris::capital: France}}', 1, 'front')).toBe('<span class="cloze">[capital: France]</span>');
  expect(renderCloze('{{c1::Paris::capital: France}}', 1, 'back')).toBe('<span class="cloze">Paris</span>');
});

test('inactive clozes show their answer', () => {
  expect(renderCloze('{{c1::a}} and {{c2::b}}', 2, 'front')).toBe('a and <span class="cloze">[…]</span>');
});

test('c10 is not mistaken for c1', () => {
  expect(renderCloze('{{c1::a}} {{c10::b}}', 1, 'front')).toBe('<span class="cloze">[…]</span> b');
});

test('malformed cloze is left as plain text', () => {
  expect(clozeNumbers('{{c1::unclosed}')).toEqual([]);
  expect(renderCloze('{{c1::unclosed}', 1, 'front')).toBe('{{c1::unclosed}');
});

test('answers may contain single braces', () => {
  expect(renderCloze('{{c1::f(x) = {x}}} done', 1, 'back')).toBe('<span class="cloze">f(x) = {x}</span> done');
});

test('nextClozeNumber', () => {
  expect(nextClozeNumber('', false)).toBe(1);
  expect(nextClozeNumber('{{c1::a}} {{c3::b}}', false)).toBe(4);
  expect(nextClozeNumber('{{c1::a}} {{c3::b}}', true)).toBe(3);
  expect(nextClozeNumber('', true)).toBe(1);
});

describe('clozes and equations', () => {
  test('a cloze inside an equation becomes TeX', () => {
    expect(renderCloze('$x = {{c1::5}}$', 1, 'front')).toBe('$x = \\htmlClass{cloze}{\\text{[…]}}$');
    expect(renderCloze('$x = {{c1::5}}$', 1, 'back')).toBe('$x = \\htmlClass{cloze}{5}$');
    expect(renderCloze('\\(x = {{c1::5}}\\)', 1, 'back')).toBe('\\(x = \\htmlClass{cloze}{5}\\)');
    expect(renderCloze('$$x = {{c1::5}}$$', 1, 'front')).toBe('$$x = \\htmlClass{cloze}{\\text{[…]}}$$');
  });

  test('the hint goes inside \\text{}', () => {
    expect(renderCloze('$x = {{c1::5::value}}$', 1, 'front')).toBe('$x = \\htmlClass{cloze}{\\text{[value]}}$');
  });

  test('a hint with TeX-special characters or HTML cannot break the equation', () => {
    expect(renderCloze('$x = {{c1::5::a_b}c}}$', 1, 'front')).toBe('$x = \\htmlClass{cloze}{\\text{[a\\_b\\}c]}}$');
    expect(renderCloze('$x = {{c1::5::<b>a</b> &amp; b}}$', 1, 'front')).toBe('$x = \\htmlClass{cloze}{\\text{[a \\&amp; b]}}$');
    const rendered = renderCloze('$x = {{c1::5::a_b}c}}$', 1, 'front');
    expect(findMath(rendered).map((m) => m.tex)).toEqual(['x = \\htmlClass{cloze}{\\text{[a\\_b\\}c]}}']);
  });

  test('an inactive cloze inside an equation shows the plain answer', () => {
    expect(renderCloze('$x = {{c1::5}}$ and {{c2::y}}', 2, 'front')).toBe('$x = 5$ and <span class="cloze">[…]</span>');
  });

  test('a cloze wrapping a whole equation keeps the HTML wrapper', () => {
    expect(renderCloze('{{c1::$x^2$}}', 1, 'front')).toBe('<span class="cloze">[…]</span>');
    expect(renderCloze('{{c1::$x^2$}}', 1, 'back')).toBe('<span class="cloze">$x^2$</span>');
  });

  test('nested braces in a clozed equation', () => {
    expect(renderCloze('{{c1::$e^{x^{2}}$}} grows', 1, 'back')).toBe('<span class="cloze">$e^{x^{2}}$</span> grows');
    expect(renderCloze('$y = {{c1::e^{x^{2}}}}$', 1, 'back')).toBe('$y = \\htmlClass{cloze}{e^{x^{2}}}$');
  });
});
