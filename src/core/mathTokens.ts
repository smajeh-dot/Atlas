/**
 * Splits the TeX inside an equation into the kinds of thing a reader scans for, so the editor can colour them: commands, Greek letters
 * and named symbols, operators, numbers, sub/superscript marks, brackets (by nesting depth), spacing, and unmatched braces.
 * Anything else (the variables, plain words) gets no token. Pure string work; positions index into `tex`.
 */

export type TexTokenKind = 'command' | 'symbol' | 'operator' | 'number' | 'script' | 'dim' | 'bracket' | 'error';

export interface TexToken {
  from: number;
  to: number;
  kind: TexTokenKind;
  /** For brackets: how many brackets are open around this one (0 = outermost). A closer has its opener's depth. */
  depth?: number;
}

type BracketType = 'group' | 'paren' | 'square' | 'curly' | 'angle' | 'floor' | 'ceil' | 'vert';

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** Greek letters and named symbols. */
const SYMBOLS = words(`
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa lambda mu nu xi pi varpi rho varrho sigma varsigma
  tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega digamma
  infty partial nabla hbar ell Re Im aleph beth gimel forall exists nexists emptyset varnothing angle measuredangle degree prime
  ldots cdots vdots ddots dots dotsb dotsc neg lnot top bot therefore because wp imath jmath Box square triangle blacksquare
`);

/** Operators and relations written as commands. */
const OPERATORS = words(`
  times cdot div ast star circ bullet oplus ominus otimes oslash odot cap cup uplus sqcap sqcup setminus wedge vee land lor pm mp
  le leq ge geq ne neq ll gg lt gt approx equiv sim simeq cong propto doteq asymp prec succ preceq succeq
  in notin ni subset supset subseteq supseteq subsetneq supsetneq sqsubset sqsupset
  to gets rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow longrightarrow longleftarrow Longrightarrow Longleftarrow
  Longleftrightarrow implies impliedby iff mapsto longmapsto uparrow downarrow Uparrow Downarrow updownarrow rightharpoonup rightleftharpoons
  perp parallel mid nmid nparallel vdash dashv models
`);

/** Spacing and layout, drawn quietly. */
const DIM_COMMANDS = words('quad qquad hspace hspace* vspace vspace* hfill vfill enspace thinspace medspace thickspace negthinspace negmedspace negthickspace nobreakspace newline cr hline');

/** Commands whose braces hold ordinary words (or a chemical formula), not maths: what's inside is left plain. */
const RAW_ARGUMENT = words('text textrm textbf textit textsf texttt textnormal mbox hbox ce pu');

/** Commands that put a size or side on the bracket that follows (\left( ... \right)). */
const SIDE = words('left right bigl bigr Bigl Bigr biggl biggr Biggl Biggr big Big bigg Bigg');

const OPENERS: Record<string, BracketType> = { langle: 'angle', lfloor: 'floor', lceil: 'ceil', lbrace: 'curly', lbrack: 'square', lvert: 'vert', lVert: 'vert' };
const CLOSERS: Record<string, BracketType> = { rangle: 'angle', rfloor: 'floor', rceil: 'ceil', rbrace: 'curly', rbrack: 'square', rvert: 'vert', rVert: 'vert' };

const WORD = /[a-zA-Z]+/y;
const NUMBER = /\d+(?:\.\d+)?/y;
const DIM_SYMBOLS = new Set(['\\', ',', ';', ':', '!', ' ', '>']);
const OPERATOR_CHARS = new Set(['+', '-', '=', '<', '>', '*', '/']);
const DIM_CHARS = new Set(['&', '~', ',', ';', ':', '.']);

export function tokenizeTex(tex: string): TexToken[] {
  const tokens: TexToken[] = [];
  const stack: { type: BracketType; token: number }[] = [];

  const open = (from: number, to: number, type: BracketType) => {
    tokens.push({ from, to, kind: 'bracket', depth: stack.length });
    stack.push({ type, token: tokens.length - 1 });
  };
  /** Closes the innermost bracket if it is of this type (round and square close each other, for intervals like [0, 1)). */
  const close = (from: number, to: number, type: BracketType): boolean => {
    const top = stack[stack.length - 1];
    const roundOrSquare = (t: BracketType) => t === 'paren' || t === 'square';
    if (!top || !(top.type === type || (roundOrSquare(type) && roundOrSquare(top.type)))) return false;
    stack.pop();
    tokens.push({ from, to, kind: 'bracket', depth: stack.length });
    return true;
  };

  const n = tex.length;
  let i = 0;
  let afterSide = false;
  while (i < n) {
    const ch = tex[i]!;
    const wasSide = afterSide;
    afterSide = false;

    if (ch === '%') {
      let j = i;
      while (j < n && tex[j] !== '\n') j++;
      tokens.push({ from: i, to: j, kind: 'dim' });
      i = j;
      continue;
    }

    if (ch === '\\') {
      WORD.lastIndex = i + 1;
      const word = WORD.exec(tex);
      if (word) {
        const name = word[0];
        const end = i + 1 + name.length;
        if (RAW_ARGUMENT.has(name)) {
          tokens.push({ from: i, to: end, kind: 'command' });
          let j = end;
          while (j < n && /\s/.test(tex[j]!)) j++;
          i = end;
          if (tex[j] === '{') {
            open(j, j + 1, 'group');
            // Skip to the matching brace without looking at what is inside.
            let k = j + 1;
            let level = 1;
            while (k < n) {
              if (tex[k] === '\\') {
                k += 2;
                continue;
              }
              if (tex[k] === '{') level++;
              else if (tex[k] === '}' && --level === 0) break;
              k++;
            }
            if (level === 0) {
              close(k, k + 1, 'group');
              i = k + 1;
            } else i = n;
          }
          continue;
        }
        if (SIDE.has(name)) {
          tokens.push({ from: i, to: end, kind: 'command' });
          afterSide = true;
        } else if (OPENERS[name]) open(i, end, OPENERS[name]!);
        else if (CLOSERS[name]) close(i, end, CLOSERS[name]!);
        else if (SYMBOLS.has(name)) tokens.push({ from: i, to: end, kind: 'symbol' });
        else if (OPERATORS.has(name)) tokens.push({ from: i, to: end, kind: 'operator' });
        else if (DIM_COMMANDS.has(name)) tokens.push({ from: i, to: end, kind: 'dim' });
        else tokens.push({ from: i, to: end, kind: 'command' });
        i = end;
        continue;
      }
      const next = tex[i + 1];
      if (next === undefined) {
        i++;
        continue;
      }
      if (next === '{') open(i, i + 2, 'curly');
      else if (next === '}') close(i, i + 2, 'curly');
      else if (DIM_SYMBOLS.has(next)) tokens.push({ from: i, to: i + 2, kind: 'dim' });
      i += 2;
      continue;
    }

    if (ch === '{') open(i, i + 1, 'group');
    else if (ch === '}') {
      if (!close(i, i + 1, 'group')) tokens.push({ from: i, to: i + 1, kind: 'error' });
    } else if (ch === '(') open(i, i + 1, 'paren');
    else if (ch === ')') close(i, i + 1, 'paren');
    else if (ch === '[') open(i, i + 1, 'square');
    else if (ch === ']') close(i, i + 1, 'square');
    else if (ch === '.' && wasSide) tokens.push({ from: i, to: i + 1, kind: 'dim' });
    else if (ch >= '0' && ch <= '9') {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(tex)!;
      tokens.push({ from: i, to: i + m[0].length, kind: 'number' });
      i += m[0].length;
      continue;
    } else if (ch === '^' || ch === '_') tokens.push({ from: i, to: i + 1, kind: 'script' });
    else if (OPERATOR_CHARS.has(ch)) tokens.push({ from: i, to: i + 1, kind: 'operator' });
    else if (DIM_CHARS.has(ch)) tokens.push({ from: i, to: i + 1, kind: 'dim' });
    i++;
  }

  // A brace group that never closes is a mistake. (An unclosed ( or [ can be real maths, like the start of an interval.)
  for (const o of stack) {
    if (o.type === 'group') tokens[o.token] = { from: tokens[o.token]!.from, to: tokens[o.token]!.to, kind: 'error' };
  }
  return tokens;
}
