import katexCss from 'katex/dist/katex.min.css?inline';
import { useLayoutEffect, useRef } from 'react';
import { extractMath } from '../../core/math';
import { ANSWER_MARKER } from '../../core/templates';
import baseCss from '../card/cardBase.css?inline';
import { hydrateMath } from '../card/math';
import { sanitizeCardHtml } from '../card/sanitize';

const DIVIDER = '<div class="atlas-divider"><span>Answer</span></div>';
const BARE = /^[^/\\:?#]+$/;

type Size = 'short' | 'long';

function region(cls: string, html: string, size: Size | undefined): HTMLDivElement {
  const div = document.createElement('div');
  div.className = cls;
  if (size) div.dataset.size = size;
  // Equations become placeholders before sanitising and are rendered after it (see hydrateMath).
  div.innerHTML = sanitizeCardHtml(extractMath(html.replace(ANSWER_MARKER, DIVIDER)));
  return div;
}

/**
 * Renders card HTML exactly as Study shows it: sanitised, inside a Shadow DOM so a note type's
 * CSS (often imported from Anki) cannot restyle the app, with media and equations resolved.
 */
export function CardView({ html, css, mediaUrl, size, answer, answerSize, className }: {
  html: string;
  css?: string;
  mediaUrl(name: string): string;
  size?: Size;
  /** When given, shown under the Answer divider. */
  answer?: string;
  answerSize?: Size;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.replaceChildren();
    // textContent, not innerHTML, so CSS containing "</style>" cannot inject markup.
    for (const text of [katexCss, baseCss, css ?? '']) {
      const style = document.createElement('style');
      style.textContent = text;
      root.append(style);
    }
    const card = document.createElement('div');
    card.className = 'atlas-card';
    if (answer === undefined) {
      card.append(region('atlas-question', html, size));
    } else {
      card.append(region('atlas-question', html, size));
      card.insertAdjacentHTML('beforeend', DIVIDER);
      card.append(region('atlas-answer', answer, answerSize));
    }
    root.append(card);
    for (const img of root.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')!;
      if (BARE.test(src)) img.setAttribute('src', mediaUrl(src));
    }
    for (const input of root.querySelectorAll<HTMLInputElement>('input.atlas-typein')) {
      input.disabled = true;
      input.placeholder = 'Type your answer, then press Enter';
    }
    hydrateMath(card);
  }, [html, css, size, answer, answerSize, mediaUrl]);
  return <div ref={host} className={className} data-cardview="" />;
}
