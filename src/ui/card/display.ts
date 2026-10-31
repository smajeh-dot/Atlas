import { hasTypeIn, fillTypeIn, stripTypeIn } from '../../core/typein';
import { isShortHtml } from '../../core/html';
import { splitAnswer } from '../../core/templates';

export type Size = 'short' | 'long';

/** How a card's front is shown (spec 10.4): short questions in the display font; the type-in box drawn separately. */
export function questionView(question: string): { html: string; size: Size; typeIn: boolean } {
  const html = stripTypeIn(question);
  return { html, size: isShortHtml(html, 140) ? 'short' : 'long', typeIn: hasTypeIn(question) };
}

/** The back split at the Answer divider, with any typed answer compared. */
export function answerView(answer: string, typed?: { text: string; fields: Record<string, string> }): { front: string | null; answer: string; size: Size } {
  const filled = typed ? fillTypeIn(answer, typed.text, typed.fields) : answer;
  const parts = splitAnswer(filled);
  return { front: parts.front, answer: parts.answer, size: isShortHtml(parts.answer, 60) ? 'short' : 'long' };
}
