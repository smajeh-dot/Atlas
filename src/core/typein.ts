import { escapeHtml, stripHtml } from './html';

export interface TypedPart {
  kind: 'ok' | 'wrong' | 'missing';
  text: string;
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Character comparison of a typed answer against the expected one, like Anki's (case-sensitive).
 * Characters in the longest common subsequence are ok; other typed characters are wrong; other
 * expected characters are missing. A wrong character is listed before the missing one it replaced.
 */
export function compareTyped(typed: string, expected: string): TypedPart[] {
  const t = [...tidy(typed)];
  const e = [...tidy(expected)];
  // lcs[i][j] = length of the longest common subsequence of t[i..] and e[j..]
  const lcs = Array.from({ length: t.length + 1 }, () => new Array<number>(e.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) {
    for (let j = e.length - 1; j >= 0; j--) {
      lcs[i]![j] = t[i] === e[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: TypedPart[] = [];
  const push = (kind: TypedPart['kind'], ch: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += ch;
    else out.push({ kind, text: ch });
  };
  let i = 0;
  let j = 0;
  while (i < t.length || j < e.length) {
    if (i < t.length && j < e.length && t[i] === e[j] && lcs[i]![j] === lcs[i + 1]![j + 1]! + 1) {
      push('ok', t[i]!);
      i++;
      j++;
    } else if (i < t.length && (j >= e.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      push('wrong', t[i++]!);
    } else {
      push('missing', e[j++]!);
    }
  }
  return out;
}

export function typeInResultHtml(typed: string, expected: string): string {
  const parts = compareTyped(typed, expected)
    .map((p) => (p.kind === 'wrong' ? `<del class="wrong">${escapeHtml(p.text)}</del>` : `<span class="${p.kind}">${escapeHtml(p.text)}</span>`))
    .join('');
  return `<div class="atlas-typein-compare">${parts}</div><div class="atlas-typein-answer">${escapeHtml(tidy(expected))}</div>`;
}

const BOX = /<input class="atlas-typein"[^>]*>/g;
const RESULT = /<div class="atlas-typein-result" data-field="([^"]*)"><\/div>/g;

export function hasTypeIn(html: string): boolean {
  return /<input class="atlas-typein"/.test(html);
}

/** Removes the type-in box from a question; the study screen draws its own input instead. */
export function stripTypeIn(html: string): string {
  return html.replace(BOX, '');
}

/** Replaces the type-in placeholders on the back with the comparison against each named field. */
export function fillTypeIn(answerHtml: string, typed: string, fields: Record<string, string>): string {
  return answerHtml.replace(RESULT, (_all, field: string) => typeInResultHtml(typed, stripHtml(fields[field] ?? '')));
}
