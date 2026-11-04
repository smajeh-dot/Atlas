import { escapeHtml } from '../../core/html';
import { findMath, type MathKind } from '../../core/math';

/**
 * Converts between stored field HTML (Anki style: inline HTML with <br>; equations Obsidian style
 * as $…$ and $$…$$, or Anki style as \( \) and \[ \]) and the HTML the editor works with
 * (paragraphs, equations as math spans).
 */

const MATH_SPAN = /<span data-math="(inline|display)">([\s\S]*?)<\/span>/g;
const ONLY_PARAGRAPHS = /^(<p>[\s\S]*?<\/p>)+$/;

export function toEditorHtml(field: string): string {
  let out = '';
  let pos = 0;
  for (const m of findMath(field)) {
    out += `${field.slice(pos, m.start)}<span data-math="${m.kind}">${escapeHtml(m.tex)}</span>`;
    pos = m.end;
  }
  return out + field.slice(pos);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ENTITIES[e]!);
/** Text made safe for a field; quotes are left alone, as in the rest of the field's text. */
const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

interface Node {
  start: number;
  end: number;
  kind: MathKind;
  tex: string;
}

function wrap(node: Node, dollars: boolean): string {
  const tex = escapeText(node.tex);
  if (node.kind === 'display') return dollars ? `$$${tex}$$` : `\\[${tex}\\]`;
  return dollars ? `$${tex}$` : `\\(${tex}\\)`;
}

/**
 * Writes equations Obsidian style. Where dollars would not read back as the same equation (a digit
 * straight after, a trailing backslash, an unescaped $ inside, and so on), it uses \( \) or \[ \].
 */
function writeMath(html: string): string {
  const nodes: Node[] = [...html.matchAll(MATH_SPAN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    kind: m[1] as MathKind,
    tex: decode(m[2]!).replace(/ /g, ' ').trim(),
  }));
  const dollars = nodes.map(() => true);
  for (;;) {
    let out = '';
    let pos = 0;
    const ranges = nodes.map((n, i) => {
      out += html.slice(pos, n.start);
      const start = out.length;
      out += wrap(n, dollars[i]!);
      pos = n.end;
      return { start, end: out.length };
    });
    out += html.slice(pos);
    const found = findMath(out);
    const bad = nodes.findIndex((n, i) => {
      if (!dollars[i]) return false;
      const r = ranges[i]!;
      return !found.some((s) => s.start === r.start && s.end === r.end && s.kind === n.kind && s.tex === n.tex);
    });
    if (bad < 0) return out;
    dollars[bad] = false;
  }
}

export function fromEditorHtml(html: string): string {
  let out = html;
  // Paragraphs become line breaks so a one-line field stays plain inline HTML, as Anki stores it.
  if (ONLY_PARAGRAPHS.test(out)) {
    const parts = [...out.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!);
    out = parts.join('<br>');
    if (parts.every((p) => p === '')) out = '';
  }
  return writeMath(out);
}
