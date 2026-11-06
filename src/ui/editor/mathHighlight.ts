import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMath } from '../../core/math';
import { tokenizeTex } from '../../core/mathTokens';

export interface MathHighlight {
  /** Index into the paragraph's text. */
  from: number;
  to: number;
  /** The TeX between the delimiters. */
  body: { from: number; to: number };
  /** The dollar signs themselves (`$` or `$$`, opening and closing), which are slanted. */
  delimiters: { from: number; to: number }[];
  /** The delimiters of the Anki style, `\(` `\)` `\[` `\]`: coloured like the dollar signs but not slanted. */
  texDelimiters: { from: number; to: number }[];
}

/**
 * What to colour in one paragraph's text: every finished equation, that is, an opening and a closing dollar sign (or `\( \)`, `\[ \]`)
 * with something between them. A single dollar sign, such as the one in a price, is not an equation and is left alone; the rules for
 * what counts are the maths parser's.
 */
export function mathHighlights(text: string): MathHighlight[] {
  if (!text.includes('$') && !text.includes('\\')) return [];
  return findMath(text).map((s) => {
    const marks = [{ from: s.start, to: s.bodyStart }, { from: s.bodyEnd, to: s.end }];
    const dollars = text[s.start] === '$';
    return { from: s.start, to: s.end, body: { from: s.bodyStart, to: s.bodyEnd }, delimiters: dollars ? marks : [], texDelimiters: dollars ? [] : marks };
  });
}

/**
 * Colours LaTeX as you type it, Obsidian style: once `$x^2$` or `$$x^2$$` (or `\(…\)`, `\[…\]`) has both its opening and closing
 * symbol, the delimiters turn blue (the dollar signs slanted a little) and what is inside is coloured by kind: commands, symbols,
 * operators, numbers, scripts, brackets by depth, and unmatched braces (see core/mathTokens). Only the display changes; the text is
 * stored exactly as typed.
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
                  const at = (from: number, to: number, cls: string) => decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: cls }));
                  at(h.from, h.to, 'atlas-math-source');
                  for (const d of h.delimiters) at(d.from, d.to, 'atlas-math-delim');
                  for (const d of h.texDelimiters) at(d.from, d.to, 'atlas-math-delim-tex');
                  for (const t of tokenizeTex(text.slice(h.body.from, h.body.to))) {
                    const cls = t.kind === 'bracket' ? `atlas-math-t atlas-math-t-bracket-${(t.depth ?? 0) % 3}` : `atlas-math-t atlas-math-t-${t.kind}`;
                    at(h.body.from + t.from, h.body.from + t.to, cls);
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
