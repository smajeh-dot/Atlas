import { expect, test } from 'vitest';
import { tokenizeTex } from '../../src/core/mathTokens';

/** `text kind` (brackets as `text bracket0`), in order, for easy reading. */
const read = (tex: string) => tokenizeTex(tex).map((t) => `${tex.slice(t.from, t.to)} ${t.kind}${t.kind === 'bracket' ? t.depth : ''}`);

test('the quadratic formula: commands, operators, numbers, scripts and braces by depth; variables are left plain', () => {
  expect(read('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')).toEqual([
    '\\frac command', '{ bracket0', '- operator', '\\pm operator', '\\sqrt command', '{ bracket1', '^ script', '2 number', '- operator', '4 number',
    '} bracket1', '} bracket0', '{ bracket0', '2 number', '} bracket0',
  ]);
});

test('Greek letters and named symbols are symbols; relations and arithmetic are operators', () => {
  expect(read('\\alpha + \\infty \\le \\Delta x')).toEqual(['\\alpha symbol', '+ operator', '\\infty symbol', '\\le operator', '\\Delta symbol']);
  expect(read('a \\times b \\cdot c \\to d \\in S')).toEqual(['\\times operator', '\\cdot operator', '\\to operator', '\\in operator']);
  expect(read('x < y > z = w')).toEqual(['< operator', '> operator', '= operator']);
});

test('functions and structure commands, and any command it does not know, are commands', () => {
  expect(read('\\sum_{i=1}^n \\sin x')).toEqual(['\\sum command', '_ script', '{ bracket0', '= operator', '1 number', '} bracket0', '^ script', '\\sin command']);
  expect(read('\\foo')).toEqual(['\\foo command']);
  expect(read('\\mathbf{v}')).toEqual(['\\mathbf command', '{ bracket0', '} bracket0']);
});

test('numbers keep their decimals; a lone full stop is quiet punctuation', () => {
  expect(read('3.14 + 10')).toEqual(['3.14 number', '+ operator', '10 number']);
  expect(read('x.')).toEqual(['. dim']);
  expect(read('x_1')).toEqual(['_ script', '1 number']);
});

test('\\left and \\right take the bracket after them, which is coloured by depth like any other', () => {
  expect(read('\\left( \\frac{a}{b} \\right)')).toEqual([
    '\\left command', '( bracket0', '\\frac command', '{ bracket1', '} bracket1', '{ bracket1', '} bracket1', '\\right command', ') bracket0',
  ]);
  // An invisible \left. is quiet; a | is left alone.
  expect(read('\\left. x \\right|')).toEqual(['\\left command', '. dim', '\\right command']);
});

test('round and square brackets close each other, so an interval like [0, 1) pairs up', () => {
  expect(read('[0, 1)')).toEqual(['[ bracket0', '0 number', ', dim', '1 number', ') bracket0']);
  expect(read('((a))')).toEqual(['( bracket0', '( bracket1', ') bracket1', ') bracket0']);
});

test('literal braces \\{ \\} and angle brackets pair up and are never a mistake', () => {
  expect(read('\\{ x \\}')).toEqual(['\\{ bracket0', '\\} bracket0']);
  expect(read('\\langle a \\rangle')).toEqual(['\\langle bracket0', '\\rangle bracket0']);
  expect(read('\\{ x')).toEqual(['\\{ bracket0']);
});

test('depth keeps counting up through nested brackets of every kind', () => {
  const depths = tokenizeTex('([{x}])').map((t) => t.depth);
  expect(depths).toEqual([0, 1, 2, 2, 1, 0]);
});

test('words inside \\text and chemistry inside \\ce are left plain, though their braces still pair up', () => {
  expect(read('\\text{rate = 5} + 1')).toEqual(['\\text command', '{ bracket0', '} bracket0', '+ operator', '1 number']);
  expect(read('\\ce{2H2 + O2 -> 2H2O}')).toEqual(['\\ce command', '{ bracket0', '} bracket0']);
  expect(read('\\text{a {nested} b} x')).toEqual(['\\text command', '{ bracket0', '} bracket0']);
});

test('spacing, alignment and comments are quiet', () => {
  expect(read('a &= b \\\\ c')).toEqual(['& dim', '= operator', '\\\\ dim']);
  expect(read('a\\,b\\quad c')).toEqual(['\\, dim', '\\quad dim']);
  expect(read('x % a note\ny')).toEqual(['% a note dim']);
});

test('escaped dollars, percent signs and the like are plain', () => {
  expect(read('\\$5 \\% 3')).toEqual(['5 number', '3 number']);
});

test('a brace that is never closed, or closed without being opened, is a mistake; a bare ( or [ is not', () => {
  expect(read('\\frac{a}{b')).toEqual(['\\frac command', '{ bracket0', '} bracket0', '{ error']);
  expect(read('a}')).toEqual(['} error']);
  expect(read('{a')).toEqual(['{ error']);
  expect(read('(a')).toEqual(['( bracket0']);
  // A ) with no ( is left alone rather than flagged: lists like "1)" are real.
  expect(read('1) a')).toEqual(['1 number']);
  // A } cannot close across a (.
  expect(read('{(}')).toEqual(['{ error', '( bracket1', '} error']);
});

test('a longer real expression: Maxwell, a matrix and a sum', () => {
  expect(read('\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}').filter((t) => t.includes('symbol'))).toEqual(['\\nabla symbol', '\\partial symbol', '\\partial symbol']);
  const matrix = read('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');
  expect(matrix.filter((t) => t.includes('number'))).toEqual(['1 number', '2 number', '3 number', '4 number']);
  expect(matrix.filter((t) => t.includes('error'))).toEqual([]);
  expect(tokenizeTex('\\sum_{k=0}^{\\infty} \\frac{x^k}{k!}').filter((t) => t.kind === 'error')).toEqual([]);
});

test('every token lies inside the text, in order, without overlapping', () => {
  for (const tex of ['\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '\\left( x \\right)', '\\text{a b} + \\ce{H2O}', '%c\nx', '\\', 'a\\', '\\{}']) {
    let end = 0;
    for (const t of tokenizeTex(tex)) {
      expect(t.from).toBeGreaterThanOrEqual(end);
      expect(t.to).toBeGreaterThan(t.from);
      expect(t.to).toBeLessThanOrEqual(tex.length);
      end = t.to;
    }
  }
});
