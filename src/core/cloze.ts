import { escapeHtml, stripHtml } from './html';
import { findMath, texText } from './math';

interface ClozeMatch {
  start: number;
  end: number; // index just past the closing }}
  num: number;
  answer: string;
  hint: string | null;
}

const OPEN = /\{\{c(\d+)::/g;

/** Finds the }} that closes a cloze, allowing single braces inside the answer. */
function findClose(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth > 0) depth--;
      else if (text[i + 1] === '}') return i;
    }
  }
  return -1;
}

function scan(text: string): ClozeMatch[] {
  const out: ClozeMatch[] = [];
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text))) {
    const bodyStart = m.index + m[0].length;
    const close = findClose(text, bodyStart);
    if (close < 0) continue;
    const body = text.slice(bodyStart, close);
    // Like Anki, the first "::" separates the answer from the hint.
    const sep = body.indexOf('::');
    out.push({
      start: m.index,
      end: close + 2,
      num: Number(m[1]),
      answer: sep < 0 ? body : body.slice(0, sep),
      hint: sep < 0 ? null : body.slice(sep + 2),
    });
    OPEN.lastIndex = close + 2;
  }
  return out;
}

export function clozeNumbers(text: string): number[] {
  return [...new Set(scan(text).map((c) => c.num))].sort((a, b) => a - b);
}

/**
 * Shows the active cloze hidden (front) or highlighted (back); the others show their answer.
 * A cloze inside an equation becomes TeX, since HTML cannot go inside one: \htmlClass{cloze}{…},
 * the only trusted command the card renderer allows.
 */
export function renderCloze(text: string, active: number, side: 'front' | 'back'): string {
  const maths = findMath(text);
  const inMath = (c: ClozeMatch) => maths.some((m) => c.start >= m.bodyStart && c.end <= m.bodyEnd);
  let out = '';
  let pos = 0;
  for (const c of scan(text)) {
    out += text.slice(pos, c.start);
    if (c.num !== active) out += c.answer;
    else if (inMath(c)) {
      // The hint is HTML; it goes into the field as escaped plain text, which the equation finder decodes.
      if (side === 'back') out += `\\htmlClass{cloze}{${c.answer}}`;
      else out += `\\htmlClass{cloze}{\\text{[${escapeHtml(texText(c.hint === null ? '…' : stripHtml(c.hint)))}]}}`;
    } else if (side === 'back') out += `<span class="cloze">${c.answer}</span>`;
    else out += `<span class="cloze">[${c.hint ?? '…'}]</span>`;
    pos = c.end;
  }
  return out + text.slice(pos);
}

/** Number for a new cloze: one more than the highest used, or the highest itself when `same` is set. */
export function nextClozeNumber(text: string, same: boolean): number {
  const nums = clozeNumbers(text);
  const max = nums.length ? nums[nums.length - 1]! : 0;
  return same ? Math.max(1, max) : max + 1;
}
