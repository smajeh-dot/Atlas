import { escapeHtml } from './html';

/**
 * Finds equations in field HTML, written Obsidian style ($inline$, $$display$$) or Anki style
 * (\(inline\), \[display\]). Pure string work: positions refer to the original HTML.
 */

export type MathKind = 'inline' | 'display';

export interface MathSpan {
  /** Index of the opening delimiter. */
  start: number;
  /** Index just past the closing delimiter. */
  end: number;
  /** Index of the first character inside the delimiters. */
  bodyStart: number;
  /** Index of the closing delimiter. */
  bodyEnd: number;
  /** The TeX inside, with tags removed and entities decoded. */
  tex: string;
  kind: MathKind;
}

const TAG = /<\/?[a-zA-Z][^<>]*>/y;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/y;
/** Elements whose content is never searched for equations. */
const RAW = /^<(code|pre|style|script)\b/i;
const BLOCK_TAG = /<\/?(div|p|ul|ol|li|table|thead|tbody|tr|td|th|pre|blockquote|h[1-6]|hr|details|summary)\b/i;
const NBSP = '&nbsp;';

interface Scan {
  spans: MathSpan[];
  /** Positions of `\$` in ordinary text (a literal dollar). */
  escapes: number[];
}

/** If a tag, comment or raw element (code, pre, style, script) starts at `i`, the index just past it. */
function skipMarkup(html: string, i: number): number {
  if (html[i] !== '<') return i;
  COMMENT.lastIndex = i;
  if (html.startsWith('<!--', i) && COMMENT.exec(html)) return COMMENT.lastIndex;
  TAG.lastIndex = i;
  const m = TAG.exec(html);
  if (!m) return i;
  const raw = RAW.exec(m[0]);
  if (!raw) return TAG.lastIndex;
  const close = html.toLowerCase().indexOf(`</${raw[1]!.toLowerCase()}`, TAG.lastIndex);
  if (close < 0) return html.length;
  const gt = html.indexOf('>', close);
  return gt < 0 ? html.length : gt + 1;
}

/**
 * Index of the first position at or after `from` where `isCloser` holds, outside markup.
 * A backslash escapes the character after it, so `\$` never closes a dollar equation.
 */
function findCloser(html: string, from: number, isCloser: (i: number) => boolean): number {
  let i = from;
  while (i < html.length) {
    const next = skipMarkup(html, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (isCloser(i)) return i;
    i += html[i] === '\\' ? 2 : 1;
  }
  return -1;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return codePoint(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith('#')) return codePoint(parseInt(lower.slice(1), 10), whole);
    return NAMED[lower] ?? whole;
  });
}

function codePoint(n: number, fallback: string): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return fallback;
  const ch = String.fromCodePoint(n);
  return ch === ' ' ? ' ' : ch;
}

/** The TeX inside an equation: line breaks kept as newlines, other tags dropped, entities decoded. */
function cleanTex(body: string): string {
  return decodeEntities(
    body
      // A break between two commands must stay whitespace: "\alpha<br>b" is not "\alphab".
      .replace(/<br\s*\/?>|<\/?(div|p)\b[^<>]*>/gi, '\n')
      .replace(/<\/?[a-zA-Z][^<>]*>/g, ''),
  )
    .replace(/ /g, ' ')
    .trim();
}

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

function tryDisplayDollar(html: string, i: number): MathSpan | null {
  const close = findCloser(html, i + 2, (j) => html[j] === '$' && html[j + 1] === '$');
  if (close < 0) return null;
  const tex = cleanTex(html.slice(i + 2, close));
  if (!tex) return null;
  return { start: i, end: close + 2, bodyStart: i + 2, bodyEnd: close, tex, kind: 'display' };
}

function tryInlineDollar(html: string, i: number): MathSpan | null {
  const after = html[i + 1];
  if (after === undefined || after === '$' || isSpace(after) || html.startsWith(NBSP, i + 1)) return null;
  const close = findCloser(html, i + 1, (j) => html[j] === '$');
  if (close < 0) return null;
  const before = html[close - 1];
  if (isSpace(before) || html.slice(close - NBSP.length, close) === NBSP) return null;
  if (/\d/.test(html[close + 1] ?? '')) return null;
  const body = html.slice(i + 1, close);
  if (/<br\b|[\n\r]/i.test(body) || BLOCK_TAG.test(body)) return null;
  const tex = cleanTex(body);
  if (!tex) return null;
  return { start: i, end: close + 1, bodyStart: i + 1, bodyEnd: close, tex, kind: 'inline' };
}

function tryBackslash(html: string, i: number, closer: string, kind: MathKind): MathSpan | null {
  const close = findCloser(html, i + 2, (j) => html.startsWith(closer, j));
  if (close < 0) return null;
  return { start: i, end: close + 2, bodyStart: i + 2, bodyEnd: close, tex: cleanTex(html.slice(i + 2, close)), kind };
}

function scan(html: string): Scan {
  const spans: MathSpan[] = [];
  const escapes: number[] = [];
  let i = 0;
  while (i < html.length) {
    const next = skipMarkup(html, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = html[i];
    let span: MathSpan | null = null;
    if (ch === '$') {
      if (html[i + 1] === '$') {
        span = tryDisplayDollar(html, i);
        // An unclosed or empty $$ is two literal dollars.
        if (!span) {
          i += 2;
          continue;
        }
      } else {
        span = tryInlineDollar(html, i);
      }
    } else if (ch === '\\') {
      const n = html[i + 1];
      if (n === '$') {
        escapes.push(i);
        i += 2;
        continue;
      }
      if (n === '[') span = tryBackslash(html, i, '\\]', 'display');
      else if (n === '(') span = tryBackslash(html, i, '\\)', 'inline');
    }
    if (span) {
      spans.push(span);
      i = span.end;
    } else {
      i++;
    }
  }
  return { spans, escapes };
}

export function findMath(html: string): MathSpan[] {
  return scan(html).spans;
}

export function hasMath(html: string): boolean {
  return findMath(html).length > 0;
}

export function hasDisplayMath(html: string): boolean {
  return findMath(html).some((s) => s.kind === 'display');
}

const BR_BEFORE = /<br\s*\/?>\s*$/i;
const BR_AFTER = /^\s*<br\s*\/?>/i;

/**
 * Replaces each equation with a placeholder for the card renderer to hydrate, turns `\$` into `$`,
 * and drops one line break on either side of a display equation (it already sits on its own line).
 * The TeX is URI-encoded in data-tex: the sanitiser drops attributes whose value contains "]>" or
 * "-->", which TeX such as "[A]>0" or "\ce{A <--> B}" would.
 */
export function extractMath(html: string): string {
  const { spans, escapes } = scan(html);
  if (!spans.length && !escapes.length) return html;
  const events = [
    ...spans.map((s) => ({ at: s.start, span: s as MathSpan | null })),
    ...escapes.map((at) => ({ at, span: null as MathSpan | null })),
  ].sort((a, b) => a.at - b.at);
  let out = '';
  let pos = 0;
  for (const { at, span } of events) {
    let text = html.slice(pos, at);
    if (!span) {
      out += `${text}$`;
      pos = at + 2;
      continue;
    }
    const display = span.kind === 'display';
    if (display) text = text.replace(BR_BEFORE, '');
    const cls = display ? 'atlas-math atlas-math-display' : 'atlas-math';
    out += `${text}<span class="${cls}" data-display="${display ? 1 : 0}" data-tex="${escapeHtml(encodeURIComponent(span.tex))}"></span>`;
    pos = span.end;
    if (display) {
      const m = BR_AFTER.exec(html.slice(pos));
      if (m) pos += m[0].length;
    }
  }
  return out + html.slice(pos);
}

const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

/** Plain text made safe to put inside \text{…}. */
export function texText(s: string): string {
  return s.replace(/[\\{}$&#%_^~]/g, (c) => TEXT_ESCAPES[c]!);
}
