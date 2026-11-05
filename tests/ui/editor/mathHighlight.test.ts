// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, expect, test } from 'vitest';
import { atlasExtensions } from '../../../src/ui/editor/extensions';
import { toEditorHtml } from '../../../src/ui/editor/fieldHtml';
import { mathHighlightKey, mathHighlights } from '../../../src/ui/editor/mathHighlight';

/** `d` is the dollar signs, as [from, to] pairs. */
const range = (open: boolean) => (from: number, to: number, ...d: [number, number][]) => ({ from, to, open, delimiters: d.map(([f, t]) => ({ from: f, to: t })) });
const done = range(false);
const open = range(true);

test('finished equations are coloured, in every way of writing them', () => {
  expect(mathHighlights('a $x^2$ b', null)).toEqual([done(2, 7, [2, 3], [6, 7])]);
  expect(mathHighlights('$$x^2$$', null)).toEqual([done(0, 7, [0, 2], [5, 7])]);
  // Anki's \\( \\) has no dollar signs to italicise.
  expect(mathHighlights('a \\(x\\) b', null)).toEqual([done(2, 7)]);
  expect(mathHighlights('plain text', null)).toEqual([]);
});

test('a price is not an equation until you are typing past its dollar sign', () => {
  expect(mathHighlights('It costs $5 and $10', null)).toEqual([]);
  expect(mathHighlights('It costs $5 and $10', 19)).toEqual([open(9, 19, [9, 10])]);
});

test('typing a dollar sign starts the colour at once, and $$ does too', () => {
  expect(mathHighlights('a $', 3)).toEqual([open(2, 3, [2, 3])]);
  expect(mathHighlights('a $x', 4)).toEqual([open(2, 4, [2, 3])]);
  expect(mathHighlights('a $$x', 5)).toEqual([open(2, 5, [2, 4])]);
  // Half way to closing a display equation: still open.
  expect(mathHighlights('$$x$', 4)).toEqual([open(0, 4, [0, 2])]);
});

test('a dollar followed by a space, an escaped dollar, or a cursor before the dollar is not the start of an equation', () => {
  expect(mathHighlights('cost $ 5', 8)).toEqual([]);
  expect(mathHighlights('cost \\$5', 8)).toEqual([]);
  expect(mathHighlights('a $x', 1)).toEqual([]);
  expect(mathHighlights('a $x', 3)).toEqual([open(2, 4, [2, 3])]);
});

test('a finished equation next to an unfinished one; the cursor inside a finished one adds nothing', () => {
  expect(mathHighlights('$a$ then $b', 11)).toEqual([done(0, 3, [0, 1], [2, 3]), open(9, 11, [9, 10])]);
  expect(mathHighlights('$x^2$', 3)).toEqual([done(0, 5, [0, 1], [4, 5])]);
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
const focus = (e: Editor, focused: boolean) => e.view.dispatch(e.state.tr.setMeta(mathHighlightKey, { focused }));
/**
 * The text carrying a class, one string per run. The italic dollar signs sit on top of the colour, so one equation is several
 * neighbouring pieces in the page (`$`, `x^2`, `$`); neighbours are joined back into one.
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
const endOfParagraph = (e: Editor, n = 0) => {
  let pos = 0;
  e.state.doc.forEach((child, offset, i) => {
    if (i === n) pos = offset + child.nodeSize - 1;
  });
  return pos;
};

test('in the editor, a finished equation is coloured even when the editor does not have the cursor', () => {
  const e = editor('<p>See $x^2$ here and $$y$$ too</p>');
  expect(coloured(e)).toEqual(['$x^2$', '$$y$$']);
});

test('in the editor, only the dollar signs are italic, not the equation inside', () => {
  const e = editor('<p>See $x^2$ here and $$y$$ too and \\(z\\)</p>');
  expect(coloured(e, '.atlas-math-delim')).toEqual(['$', '$', '$$', '$$']);
  expect(coloured(e)).toEqual(['$x^2$', '$$y$$', '\\(z\\)']);
});

test('in the editor, an equation being typed has only its opening dollar sign italic', () => {
  const e = editor('<p>Hi</p>');
  focus(e, true);
  e.commands.setTextSelection(endOfParagraph(e));
  e.commands.insertContent({ type: 'text', text: ' $$x' });
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$$x']);
  expect(coloured(e, '.atlas-math-delim')).toEqual(['$$']);
});

test('in the editor, the colour starts as you type the opening dollar and ends up on the finished equation', () => {
  const e = editor('<p>Hi</p>');
  focus(e, true);
  e.commands.setTextSelection(endOfParagraph(e));
  e.commands.insertContent({ type: 'text', text: ' ' });
  expect(coloured(e)).toEqual([]);
  e.commands.insertContent('$');
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$']);
  e.commands.insertContent('x^2');
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$x^2']);
  e.commands.insertContent('$');
  // Closed: now a finished equation, no longer "open".
  expect(coloured(e, '.atlas-math-source-open')).toEqual([]);
  expect(coloured(e)).toEqual(['$x^2$']);
  expect(e.getText()).toBe('Hi $x^2$');
});

test('an unfinished equation is only coloured while the editor has the cursor', () => {
  const e = editor('<p>Cost $5</p>');
  e.commands.setTextSelection(endOfParagraph(e));
  expect(coloured(e)).toEqual([]);
  focus(e, true);
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$5']);
  focus(e, false);
  expect(coloured(e)).toEqual([]);
});

test('the cursor in another paragraph does not colour this paragraph\'s unfinished dollar', () => {
  const e = editor('<p>Cost $5</p><p>next</p>');
  focus(e, true);
  e.commands.setTextSelection(endOfParagraph(e, 1));
  expect(coloured(e)).toEqual([]);
  e.commands.setTextSelection(endOfParagraph(e, 0));
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$5']);
});

test('the colour lands on the right text after a rendered equation earlier in the paragraph', () => {
  const e = editor(toEditorHtml('$a$ then $b'));
  expect(e.view.dom.querySelector('.atlas-math')).not.toBeNull();
  focus(e, true);
  e.commands.setTextSelection(endOfParagraph(e));
  expect(coloured(e, '.atlas-math-source-open')).toEqual(['$b']);
});

test('colouring changes nothing about what is stored', () => {
  const e = editor('<p>See $x^2$ here</p>');
  expect(e.getHTML()).toBe('<p>See $x^2$ here</p>');
});
