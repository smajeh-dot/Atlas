import katex, { type KatexOptions, type TrustContext } from 'katex';
// Adds \ce{} and \pu{} for chemistry.
import 'katex/contrib/mhchem';

const MACROS: Record<string, string> = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
};

export const KATEX_OPTIONS = {
  throwOnError: false,
  errorColor: 'var(--danger)',
  // Required: with the default 'warn', \htmlClass is disabled.
  strict: 'ignore',
  // Only the cloze highlight is trusted: no links, images, styles, data attributes or other classes.
  trust: (c: TrustContext) => c.command === '\\htmlClass' && c.class === 'cloze',
  // Stops recursive macros such as \def\a{\a\a}\a quickly.
  maxExpand: 1000,
  maxSize: 50,
  macros: MACROS,
} satisfies KatexOptions;

const LIMIT = 500;
const cache = new Map<string, string>();

/** KaTeX HTML for an equation, remembered so stepping through cards does not render it again. */
export function renderTex(tex: string, displayMode: boolean): string {
  const key = `${displayMode ? 1 : 0}|${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  // A fresh macros object each time: KaTeX writes \gdef definitions into it, which would leak between cards.
  const html = katex.renderToString(tex, { ...KATEX_OPTIONS, macros: { ...MACROS }, displayMode });
  cache.set(key, html);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return html;
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Renders the equation placeholders that extractMath (core/math.ts) left in sanitised card HTML. */
export function hydrateMath(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('.atlas-math[data-tex]')) {
    const tex = decode(el.getAttribute('data-tex')!);
    if (tex === null) continue;
    // innerHTML is acceptable here only because this is KaTeX's own output under the restricted
    // `trust` above; it runs after the sanitiser, which would otherwise strip KaTeX's markup.
    el.innerHTML = renderTex(tex, el.dataset.display === '1');
  }
}
