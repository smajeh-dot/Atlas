import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const THEME = 'src/ui/theme';
const read = (f: string) => readFileSync(join(THEME, f), 'utf8');

function declared(file: string, token: string): string | undefined {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(read(file));
  return m?.[1]?.trim();
}

// Spec 8.3, 8.4 and 8.5, copied verbatim. --text-answer fills a gap (used in 10.4, missing from 8.3).
const SPEC: [string, string, string][] = [
  ['--bg-app', '#F9F9F7', '#EFEFEC'], ['--bg-main', '#F9F9F7', '#EFEFEC'], ['--bg-panel', '#FFFFFF', '#FFFFFF'],
  ['--bg-raised', '#F4F4F2', '#F5F5F2'], ['--bg-preview', '#F7F7F5', '#FFE2D2'], ['--border', '#E2E2E6', '#141414'],
  ['--border-soft', '#E2E2E6', '#DADAD5'], ['--text', '#1C1C1F', '#141414'], ['--text-muted', '#6B6B74', '#4E4E4E'],
  ['--text-faint', '#9A9AA2', '#8A8A8A'], ['--accent', '#2F5FCE', '#FF5B14'], ['--accent-ink', '#FFFFFF', '#141414'],
  ['--accent-soft', '#EAF0FB', '#FFE2D2'], ['--sidebar-bg', '#FFFFFF', '#FFFFFF'], ['--sidebar-header-rule', '#D4D4D4', '#D4D4D4'], ['--new-btn-bg', '#FFFFFF', '#FFFFFF'], ['--new-btn-hover', '#F7F7F7', '#F7F7F7'], ['--menu-card-bg', '#FFFFFF', '#FFFFFF'], ['--table-head-ink', '#000000', '#000000'], ['--sidebar-text', '#1C1C1F', '#141414'],
  ['--sidebar-text-muted', '#6B6B74', '#3A3A3A'], ['--sidebar-active-bg', '#EDECE8', '#FF5B14'],
  ['--sidebar-active-text', '#1C1C1F', '#141414'], ['--sidebar-label', '#9A9AA2', '#8A8A8A'],
  ['--mark-bg', '#2F5FCE', '#FF5B14'], ['--mark-ink', '#FFFFFF', '#141414'], ['--add-bg', '#FFFFFF', '#141414'],
  ['--add-ink', '#1C1C1F', '#FFFFFF'], ['--hero-bg', 'transparent', '#FF5B14'], ['--hero-text', '#1C1C1F', '#141414'],
  ['--hero-muted', '#6B6B74', 'rgba(20,20,20,0.75)'], ['--hero-btn-bg', '#17171A', '#141414'], ['--hero-btn-ink', '#FFFFFF', '#FFFFFF'],
  ['--primary-bg', '#17171A', '#141414'], ['--primary-ink', '#FFFFFF', '#FFFFFF'], ['--primary-hover-bg', '#000000', '#000000'],
  ['--hover-bg', 'rgba(0,0,0,0.03)', '#F5F5F2'], ['--press-bg', 'rgba(0,0,0,0.08)', '#EDEDE8'],
  ['--count-new', '#2F5FCE', '#2D5BFF'], ['--count-learn', '#B3261E', '#E5341B'], ['--count-due', '#1E7D32', '#0E8F45'],
  ['--heat', '#2F5FCE', '#FF5B14'], ['--bar', '#D9DEEA', '#141414'], ['--tag-bg', '#EEEEEF', '#FFE2D2'], ['--tag-ink', '#4A4A52', '#141414'],
  ['--grade-again-bg', '#d13c30', '#d13c30'], ['--grade-again-ink', '#FFFFFF', '#FFFFFF'],
  ['--grade-hard-bg', '#d98200', '#d98200'], ['--grade-hard-ink', '#FFFFFF', '#FFFFFF'],
  ['--grade-good-bg', '#13a10e', '#13a10e'], ['--grade-good-ink', '#FFFFFF', '#FFFFFF'],
  ['--grade-easy-bg', '#237bdb', '#237bdb'], ['--grade-easy-ink', '#FFFFFF', '#FFFFFF'],
  ['--focus', '#2F5FCE', '#141414'], ['--focus-soft', 'rgba(47,95,206,0.14)', 'rgba(255,91,20,0.35)'],
  ['--focus-edit', 'rgba(47,95,206,0.14)', '#FF7A1F'],
  ['--danger', '#D32F2F', '#E5341B'], ['--danger-ink', '#FFFFFF', '#141414'], ['--success', '#1E7D32', '#0E8F45'],
  ['--warning-bg', '#FDF3DC', '#FFC53D'], ['--warning-ink', '#7A5300', '#141414'], ['--overlay', 'rgba(0,0,0,0.40)', 'rgba(20,20,20,0.45)'],
  ['--text-answer', '#1C1C1F', '#141414'],
  ['--border-w', '1px', '2px'], ['--radius-sm', '8px', '8px'], ['--radius-btn', '999px', '10px'], ['--radius-btn-lg', '12px', '12px'],
  ['--radius-lg', '12px', '14px'], ['--radius-card', '14px 14px 14px 0', '14px'], ['--radius-field', '8px', '10px'],
  ['--radius-panel-side', '12px 12px 12px 0', '0'], ['--radius-panel-main', '12px 12px 0 12px', '0'], ['--radius-hero', '0', '14px'],
  ['--shadow-box', 'none', '4px 4px 0 #141414'], ['--shadow-primary', 'none', '3px 3px 0 #FF5B14'],
  ['--shadow-hero', 'none', '5px 5px 0 #141414'], ['--shadow-grade', 'none', '3px 3px 0 #141414'],
  ['--shadow-popover', '0 8px 24px rgba(0,0,0,0.08)', '4px 4px 0 #141414'], ['--shell-pad', '12px', '0'], ['--sidebar-bleed', '12px', '0'], ['--sidebar-edge', 'none', 'none'], ['--sidebar-divider', '1px solid #E2E2E6', '2px solid #141414'], ['--shell-gap', '12px', '0'],
  ['--font-display', "'Anthropic Serif', Georgia, 'Times New Roman', serif", "'Anthropic Serif', Georgia, 'Times New Roman', serif"],
  ['--font-body', "'Anthropic Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", "'Anthropic Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"],
  ['--font-mono', "'Anthropic Mono', 'Cascadia Code', Consolas, monospace", "'Anthropic Mono', 'Cascadia Code', Consolas, monospace"],
  ['--weight-display', '500', '500'], ['--tracking-display', '-0.01em', '-0.03em'],
];

test.each(SPEC)('%s has the spec value in both themes', (token, wb, tg) => {
  expect(declared('workbench.css', token)).toBe(wb);
  expect(declared('tangerine.css', token)).toBe(tg);
});

test('shared tokens: flags, deck colours and the type scale', () => {
  const flags = ['#D32F2F', '#F08A24', '#1E9E4A', '#2F6FCE', '#E0559A', '#1AA6A6', '#7A4FD0'];
  const decks = ['#1E7D32', '#B5651D', '#2F5FCE', '#B3261E', '#7A4FD0', '#1AA6A6', '#C28A00', '#E0559A'];
  flags.forEach((c, i) => expect(declared('tokens.css', `--flag-${i + 1}`)).toBe(c));
  decks.forEach((c, i) => expect(declared('tokens.css', `--deck-${i + 1}`)).toBe(c));
  const scale = [['label', '11.5px'], ['sm', '12.5px'], ['ui', '13.5px'], ['body', '15px'], ['lg', '17px'], ['xl', '19px'], ['2xl', '25px'], ['3xl', '30px'], ['4xl', '38px']];
  for (const [n, v] of scale) expect(declared('tokens.css', `--fs-${n}`)).toBe(v);
});

test('both theme files declare the same tokens and scope them by data-theme', () => {
  const names = (f: string) => [...read(f).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();
  expect(names('tangerine.css')).toEqual(names('workbench.css'));
  expect(read('workbench.css')).toContain("[data-theme='workbench']");
  expect(read('tangerine.css')).toContain("[data-theme='tangerine']");
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('every token used in src/ui is declared somewhere', () => {
  const files = walk('src/ui').filter((f) => /\.(css|tsx?)$/.test(f));
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const declaredNames = new Set([...all.matchAll(/(--[\w-]+)\s*:/g), ...all.matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]));
  const used = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  expect([...used].filter((u) => !declaredNames.has(u))).toEqual([]);
});
