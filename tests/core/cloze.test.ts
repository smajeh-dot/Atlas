import { expect, test } from 'vitest';
import { clozeNumbers, renderCloze } from '../../src/core/cloze';

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
