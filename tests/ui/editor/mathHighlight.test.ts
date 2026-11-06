// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, test } from 'vitest';
import { atlasExtensions } from '../../../src/ui/editor/extensions';
import { mathHighlights } from '../../../src/ui/editor/mathHighlight';

type Pair = [number, number];
/** An equation: where it sits, its TeX body, its dollar signs, and its Anki-style delimiters. */
const eq = (from: number, to: number, body: Pair, dollars: Pair[] = [], tex: Pair[] = []) => ({
  from,
  to,
  body: { from: body[0], to: body[1] },
  delimiters: dollars.map(([f, t]) => ({ from: f, to: t })),
  texDelimiters: tex.map(([f, t]) => ({ from: f, to: t })),
});

test('finished equations are found, in every way of writing them', () => {
  expect(mathHighlights('a $x^2$ b')).toEqual([eq(2, 7, [3, 6], [[2, 3], [6, 7]])]);
  expect(mathHighlights('$$x^2$$')).toEqual([eq(0, 7, [2, 5], [[0, 2], [5, 7]])]);
  // Anki's \( \) is found too, with delimiters of its own and no dollar signs to slant.
  expect(mathHighlights('a \\(x\\) b')).toEqual([eq(2, 7, [4, 5], [], [[2, 4], [5, 7]])]);
  expect(mathHighlights('plain text')).toEqual([]);
});

test('one dollar sign is not an equation: nothing changes until the closing one is typed', () => {
  expect(mathHighlights('a $')).toEqual([]);
  expect(mathHighlights('a $x')).toEqual([]);
  expect(mathHighlights('a $x^2')).toEqual([]);
  expect(mathHighlights('$$x')).toEqual([]);
  expect(mathHighlights('$$x$')).toEqual([]);
  // ...and then it does.
  expect(mathHighlights('a $x^2$')).toEqual([eq(2, 7, [3, 6], [[2, 3], [6, 7]])]);
  expect(mathHighlights('$$x$$')).toEqual([eq(0, 5, [2, 3], [[0, 2], [3, 5]])]);
});

test('prices, a dollar followed by a space, and an escaped dollar are left alone', () => {
  expect(mathHighlights('It costs $5 and $10')).toEqual([]);
  expect(mathHighlights('cost $ 5')).toEqual([]);
  expect(mathHighlights('cost \\$5 and \\$6')).toEqual([]);
});

test('two equations in one paragraph are both found', () => {
  expect(mathHighlights('$a$ then $b$')).toEqual([eq(0, 3, [1, 2], [[0, 1], [2, 3]]), eq(9, 12, [10, 11], [[9, 10], [11, 12]])]);
});

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function editor(html: string) {
  const element = document.createElement('div');
  document.body.append(element);
  const e = new Editor({ element, extensions: atlasExtensions({ mediaUrl: (n) => n, getAllText: () => '' }), content: html });
  editors.push(e);
  return e;
}
/**
 * The text carrying a class, one string per run. Decorations split one equation into several neighbouring pieces in the page
 * (`$`, `x^2`, `$`); neighbours are joined back into one.
 */
const coloured = (e: Editor, cls = '.atlas-math-source') => {
  const runs: string[] = [];
  let before: Node | null = null;
  for (const n of e.view.dom.querySelectorAll(cls)) {
    if (before && before.nextSibling === n && runs.length) runs[runs.length - 1] += n.textContent;
    else runs.push(n.textContent ?? '');
    before = n;
  }
  return runs;
};
const endOfParagraph = (e: Editor) => e.state.doc.firstChild!.nodeSize - 1;

test('in the editor, finished equations are found and only their dollar signs are marked', () => {
  const e = editor('<p>See $x^2$ here and $$y$$ too and \\(z\\)</p>');
  expect(coloured(e)).toEqual(['$x^2$', '$$y$$', '\\(z\\)']);
  expect(coloured(e, '.atlas-math-delim')).toEqual(['$', '$', '$$', '$$']);
});

test('in the editor, each kind of thing in an equation gets its own colour class, and variables get none', () => {
  const e = editor('<p>$\\frac{a}{b} + 2 \\alpha x^2$</p>');
  expect(coloured(e, '.atlas-math-t-command')).toEqual(['\\frac']);
  expect(coloured(e, '.atlas-math-t-operator')).toEqual(['+']);
  expect(coloured(e, '.atlas-math-t-number')).toEqual(['2', '2']);
  expect(coloured(e, '.atlas-math-t-symbol')).toEqual(['\\alpha']);
  expect(coloured(e, '.atlas-math-t-script')).toEqual(['^']);
  // (the } and { in \\frac{a}{b} touch, so they read as one run)
  expect(coloured(e, '.atlas-math-t-bracket-0')).toEqual(['{', '}{', '}']);
  // The variables a, b and x are plain: the coloured tokens, put together, are exactly the commands, brackets, operator, numbers and script mark.
  expect([...e.view.dom.querySelectorAll('.atlas-math-t')].map((n) => n.textContent).join('')).toBe('\\frac{}{}+2\\alpha^2');
});

test('in the editor, brackets are coloured by how deeply they are nested', () => {
  const e = editor('<p>$((a)) [b]$</p>');
  expect(coloured(e, '.atlas-math-t-bracket-0')).toEqual(['(', ')', '[', ']']);
  expect(coloured(e, '.atlas-math-t-bracket-1')).toEqual(['(', ')']);
});

test('in the editor, a brace that never closes is flagged; a closed one is not', () => {
  expect(coloured(editor('<p>$\\frac{a}{b$</p>'), '.atlas-math-t-error')).toEqual(['{']);
  expect(coloured(editor('<p>$\\frac{a}{b}$</p>'), '.atlas-math-t-error')).toEqual([]);
});

test('in the editor, Anki-style delimiters are coloured like dollar signs but not slanted', () => {
  const e = editor('<p>See \\(x + 1\\) here</p>');
  expect(coloured(e, '.atlas-math-delim-tex')).toEqual(['\\(', '\\)']);
  expect(coloured(e, '.atlas-math-delim')).toEqual([]);
  expect(coloured(e, '.atlas-math-t-operator')).toEqual(['+']);
});

test('in the editor, nothing inside is coloured until the closing dollar sign is typed', () => {
  const e = editor('<p>$\\frac{a}{b} + 2</p>');
  expect(e.view.dom.querySelectorAll('.atlas-math-t')).toHaveLength(0);
});

test('in the editor, nothing changes when you type the first dollar sign; the colour arrives with the second', () => {
  const e = editor('<p>Hi</p>');
  e.commands.setTextSelection(endOfParagraph(e));
  e.commands.insertContent({ type: 'text', text: ' ' });
  e.commands.insertContent('$');
  expect(coloured(e)).toEqual([]);
  expect(coloured(e, '.atlas-math-delim')).toEqual([]);
  e.commands.insertContent('x^2');
  expect(coloured(e)).toEqual([]);
  e.commands.insertContent('$');
  expect(coloured(e)).toEqual(['$x^2$']);
  expect(coloured(e, '.atlas-math-delim')).toEqual(['$', '$']);
  expect(coloured(e, '.atlas-math-t-script')).toEqual(['^']);
  expect(e.getText()).toBe('Hi $x^2$');
});

test('in the editor, a price stays plain', () => {
  const e = editor('<p>It costs $5 and $10</p>');
  expect(coloured(e)).toEqual([]);
  expect(e.view.dom.querySelectorAll('.atlas-math-t')).toHaveLength(0);
});

test('the colour lands on the right text after a rendered equation earlier in the paragraph', () => {
  const after = editor('<p><span data-math="inline">a</span> then $b + 1$</p>');
  expect(after.view.dom.querySelector('.atlas-math')).not.toBeNull();
  expect(coloured(after)).toEqual(['$b + 1$']);
  expect(coloured(after, '.atlas-math-t-operator')).toEqual(['+']);
});

test('colouring changes nothing about what is stored', () => {
  const e = editor('<p>See $\\frac{a}{b} + 2$ here</p>');
  expect(e.getHTML()).toBe('<p>See $\\frac{a}{b} + 2$ here</p>');
});
