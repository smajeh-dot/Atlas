import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMath } from '../../core/math';

export interface MathHighlight {
  /** Index into the paragraph's text. */
  from: number;
  to: number;
  /** The dollar signs themselves (`$` or `$$`, opening and closing), which are slanted. `\(` and `\[` have none. */
  delimiters: { from: number; to: number }[];
}

/**
 * What to colour in one paragraph's text: every finished equation, that is, an opening and a closing dollar sign (or `\( \)`, `\[ \]`)
 * with something between them. A single dollar sign, such as the one in a price, is not an equation and is left alone; the rules for
 * what counts are the maths parser's.
 */
export function mathHighlights(text: string): MathHighlight[] {
  if (!text.includes('$') && !text.includes('\\')) return [];
  return findMath(text).map((s) => ({
    from: s.start,
    to: s.end,
    delimiters: text[s.start] === '$' ? [{ from: s.start, to: s.bodyStart }, { from: s.bodyEnd, to: s.end }] : [],
  }));
}

/**
 * Colours LaTeX as you type it, Obsidian style: once `$x^2$` or `$$x^2$$` (or `\(…\)`, `\[…\]`) has both its opening and closing
 * symbol, it takes the maths colour and the dollar signs are slanted a little. Only the display changes; the text is stored
 * exactly as typed.
 */
export const MathHighlight = Extension.create({
  name: 'atlasMathHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock) return true;
              if (node.textContent.includes('$') || node.textContent.includes('\\')) {
                // One character per position: text as typed, a line break as a newline, any other inline thing (an equation, a picture) as a placeholder.
                let text = '';
                node.forEach((child) => {
                  text += child.isText ? child.text! : child.type.name === 'hardBreak' ? '\n' : '￼'.repeat(child.nodeSize);
                });
                for (const h of mathHighlights(text)) {
                  decorations.push(Decoration.inline(pos + 1 + h.from, pos + 1 + h.to, { class: 'atlas-math-source' }));
                  for (const d of h.delimiters) {
                    decorations.push(Decoration.inline(pos + 1 + d.from, pos + 1 + d.to, { class: 'atlas-math-delim' }));
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
