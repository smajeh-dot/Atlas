import { expect, test } from 'vitest';
import { compareTyped, fillTypeIn, hasTypeIn, revealTypeIn, stripTypeIn, typeInResultHtml } from '../../src/core/typein';

test('compareTyped marks ok, wrong and missing', () => {
  expect(compareTyped('Pari', 'Paris')).toEqual([{ kind: 'ok', text: 'Pari' }, { kind: 'missing', text: 's' }]);
  expect(compareTyped('Parjs', 'Paris')).toEqual([
    { kind: 'ok', text: 'Par' }, { kind: 'wrong', text: 'j' }, { kind: 'missing', text: 'i' }, { kind: 'ok', text: 's' }]);
  expect(compareTyped('  Paris ', 'Paris')).toEqual([{ kind: 'ok', text: 'Paris' }]);
  expect(compareTyped('', 'ab')).toEqual([{ kind: 'missing', text: 'ab' }]);
  expect(compareTyped('paris', 'Paris')).toEqual([{ kind: 'wrong', text: 'p' }, { kind: 'missing', text: 'P' }, { kind: 'ok', text: 'aris' }]);
  expect(compareTyped('a  b', 'a b')).toEqual([{ kind: 'ok', text: 'a b' }]);
});

test('typeInResultHtml escapes and shows the correct answer', () => {
  const html = typeInResultHtml('<b>', 'x<y');
  expect(html).not.toContain('<b>');
  expect(html).toContain('<div class="atlas-typein-answer">x&lt;y</div>');
  expect(html.startsWith('<div class="atlas-typein-compare">')).toBe(true);
  expect(typeInResultHtml('ab', 'ac')).toContain('<span class="ok">a</span><del class="wrong">b</del><span class="missing">c</span>');
});

test('fillTypeIn uses the named field as plain text', () => {
  const html = fillTypeIn('Q<!--atlas:answer--><div class="atlas-typein-result" data-field="Back"></div>', 'Paris', { Back: '<b>Paris</b>' });
  expect(html).toContain('<span class="ok">Paris</span>');
  expect(html).not.toContain('atlas-typein-result');
});

test('hasTypeIn and stripTypeIn', () => {
  const q = 'Capital of France?<input class="atlas-typein" data-field="Back">';
  expect(hasTypeIn(q)).toBe(true);
  expect(hasTypeIn('plain')).toBe(false);
  expect(stripTypeIn(q)).toBe('Capital of France?');
});

test('revealTypeIn shows the expected text alone, with no comparison', () => {
  const html = revealTypeIn('Q<!--atlas:answer--><div class="atlas-typein-result" data-field="Back"></div>', { Back: '<b>Paris</b>' });
  expect(html).toBe('Q<!--atlas:answer--><div class="atlas-typein-answer">Paris</div>');
});
