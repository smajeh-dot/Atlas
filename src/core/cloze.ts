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

export function renderCloze(text: string, active: number, side: 'front' | 'back'): string {
  let out = '';
  let pos = 0;
  for (const c of scan(text)) {
    out += text.slice(pos, c.start);
    if (c.num !== active) out += c.answer;
    else if (side === 'back') out += `<span class="cloze">${c.answer}</span>`;
    else out += `<span class="cloze">[${c.hint ?? '…'}]</span>`;
    pos = c.end;
  }
  return out + text.slice(pos);
}
