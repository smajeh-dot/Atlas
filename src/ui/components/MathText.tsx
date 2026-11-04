import { useLayoutEffect, useRef } from 'react';
import { escapeHtml } from '../../core/html';
import { extractMath } from '../../core/math';
import { hydrateMath } from '../card/math';
import styles from './MathText.module.css';

/**
 * Plain text with equations ($…$, $$…$$, \( \), \[ \]) rendered by KaTeX, for screens that show card
 * text outside CardView. The text is escaped first, so it can never become HTML.
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only escaped text, equation placeholders and KaTeX's own output (see hydrateMath) go in here.
    el.innerHTML = extractMath(escapeHtml(text));
    hydrateMath(el);
  }, [text]);
  return <p ref={ref} className={`${styles.root} ${className ?? ''}`} />;
}
