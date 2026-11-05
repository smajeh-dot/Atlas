import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMath } from '../../core/math';

export interface MathHighlight {
  /** Index into the paragraph's text. */
  from: number;
  to: number;
  /** True for an equation still being typed: its opening $ is there but no closing one yet. */
  open: boolean;
}

/**
 * Index of an opening `$` or `$$` before `caret` that has no matching close yet, if there is one. A `$` followed by a space is a plain
 * dollar sign, `\$` is an escaped one, and anything inside a finished equation is skipped; the rules are the maths parser's.
 */
function findOpener(text: string, done: { start: number; end: number }[], caret: number): number | null {
  let i = 0;
  while (i < caret && i < text.length) {
    const finished = done.find((s) => s.start === i);
    if (finished) {
      i = finished.end;
      continue;
    }
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '$') {
      const next = text[i + 1];
      if (next === '$' || next === undefined || !/\s/.test(next)) return i;
    }
    i++;
  }
  return null;
}

/**
 * What to colour in one paragraph's text: every finished equation, and, when the cursor (`caret`, an index into `text`, or null when it
 * isn't here) is past an opening `$` that hasn't been closed, everything from that `$` to the end, so the colour changes the moment you
 * start an equation.
 */
export function mathHighlights(text: string, caret: number | null): MathHighlight[] {
  if (!text.includes('$') && !text.includes('\\')) return [];
  const spans = findMath(text);
  const out: MathHighlight[] = spans.map((s) => ({ from: s.start, to: s.end, open: false }));
  if (caret !== null) {
    const at = findOpener(text, spans, caret);
    if (at !== null) out.push({ from: at, to: text.length, open: true });
  }
  return out;
}

/** Whether the editor has the cursor: an unfinished equation is only coloured while you are typing in it. */
export const mathHighlightKey = new PluginKey<{ focused: boolean }>('atlasMathHighlight');

/**
 * Colours LaTeX as you type it, Obsidian style: `$x^2$` and `$$x^2$$` (and `\(…\)`, `\[…\]`) take the maths colour, starting from the
 * opening `$`. Only the colour changes; the text is stored exactly as typed.
 */
export const MathHighlight = Extension.create({
  name: 'atlasMathHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mathHighlightKey,
        state: {
          init: () => ({ focused: false }),
          apply: (tr, value) => tr.getMeta(mathHighlightKey) ?? value,
        },
        props: {
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(mathHighlightKey, { focused: true }));
              return false;
            },
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(mathHighlightKey, { focused: false }));
              return false;
            },
          },
          decorations(state) {
            const focused = mathHighlightKey.getState(state)?.focused ?? false;
            const { selection } = state;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock) return true;
              if (node.textContent.includes('$') || node.textContent.includes('\\')) {
                // One character per position: text as typed, a line break as a newline, any other inline thing (an equation, a picture) as a placeholder.
                let text = '';
                node.forEach((child) => {
                  text += child.isText ? child.text! : child.type.name === 'hardBreak' ? '\n' : '￼'.repeat(child.nodeSize);
                });
                const here = focused && selection.empty && selection.$head.parent === node;
                const caret = here ? selection.$head.parentOffset : null;
                for (const h of mathHighlights(text, caret)) {
                  if (h.to > h.from) {
                    decorations.push(Decoration.inline(pos + 1 + h.from, pos + 1 + h.to, { class: h.open ? 'atlas-math-source atlas-math-source-open' : 'atlas-math-source' }));
                  }
                }
              }
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
