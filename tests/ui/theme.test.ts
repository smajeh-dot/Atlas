import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const THEME = 'src/ui/theme';
const read = (f: string) => readFileSync(join(THEME, f), 'utf8');

function declared(file: string, token: string): string | undefined {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(read(file));
  return m?.[1]?.trim();
}

// Spec 8.3, 8.4 and 8.5 (Light theme values), copied verbatim. --text-answer fills a gap (used in 10.4, missing from 8.3).
const SPEC: [string, string][] = [
  ['--bg-app', '#F9F9F7'], ['--bg-main', '#F9F9F7'], ['--bg-panel', '#FFFFFF'],
  ['--bg-raised', '#F4F4F2'], ['--bg-preview', '#F7F7F5'], ['--border', '#E2E2E6'],
  ['--border-soft', '#E2E2E6'], ['--text', '#1C1C1F'], ['--text-muted', '#6B6B74'],
  ['--text-faint', '#9A9AA2'], ['--accent', '#2F5FCE'], ['--accent-ink', '#FFFFFF'],
  ['--accent-soft', '#EAF0FB'], ['--sidebar-bg', '#FFFFFF'], ['--sidebar-header-rule', '#D4D4D4'], ['--new-btn-bg', '#FFFFFF'], ['--new-btn-hover', '#F7F7F7'], ['--menu-card-bg', '#FFFFFF'], ['--table-head-ink', '#000000'], ['--sidebar-text', '#1C1C1F'],
  ['--sidebar-text-muted', '#6B6B74'], ['--sidebar-active-bg', '#EDECE8'],
  ['--sidebar-active-text', '#1C1C1F'], ['--sidebar-label', '#9A9AA2'],
  ['--mark-bg', '#2F5FCE'], ['--mark-ink', '#FFFFFF'], ['--add-bg', '#FFFFFF'],
  ['--add-ink', '#1C1C1F'], ['--hero-bg', 'transparent'], ['--hero-text', '#1C1C1F'],
  ['--hero-muted', '#6B6B74'], ['--hero-btn-bg', '#17171A'], ['--hero-btn-ink', '#FFFFFF'],
  ['--primary-bg', '#17171A'], ['--primary-ink', '#FFFFFF'], ['--primary-hover-bg', '#000000'],
  ['--hover-bg', 'rgba(0,0,0,0.03)'], ['--press-bg', 'rgba(0,0,0,0.08)'],
  ['--count-new', '#2F5FCE'], ['--count-learn', '#B3261E'], ['--count-due', '#1E7D32'],
  ['--heat', '#2F5FCE'], ['--bar', '#D9DEEA'], ['--tag-bg', '#EEEEEF'], ['--tag-ink', '#4A4A52'],
  ['--grade-again-bg', '#d13c30'], ['--grade-again-ink', '#FFFFFF'],
  ['--grade-hard-bg', '#d98200'], ['--grade-hard-ink', '#FFFFFF'],
  ['--grade-good-bg', '#13a10e'], ['--grade-good-ink', '#FFFFFF'],
  ['--grade-easy-bg', '#237bdb'], ['--grade-easy-ink', '#FFFFFF'],
  ['--focus', '#2F5FCE'], ['--focus-soft', 'rgba(47,95,206,0.14)'],
  ['--focus-edit', 'rgba(47,95,206,0.14)'],
  ['--danger', '#D32F2F'], ['--danger-ink', '#FFFFFF'], ['--success', '#1E7D32'],
  ['--warning-bg', '#FDF3DC'], ['--warning-ink', '#7A5300'], ['--overlay', 'rgba(0,0,0,0.40)'],
  ['--text-answer', '#1C1C1F'],
  ['--border-w', '1px'], ['--radius-sm', '8px'], ['--radius-btn', '8px'], ['--radius-btn-lg', '12px'],
  ['--radius-lg', '12px'], ['--radius-card', '14px 14px 14px 0'], ['--radius-field', '8px'],
  ['--radius-panel-side', '12px 12px 12px 0'], ['--radius-panel-main', '12px 12px 0 12px'], ['--radius-hero', '0'],
  ['--shadow-box', 'none'], ['--shadow-primary', 'none'],
  ['--shadow-hero', 'none'], ['--shadow-grade', 'none'],
  ['--shadow-popover', '0 8px 24px rgba(0,0,0,0.08)'], ['--shell-pad', '12px'], ['--sidebar-bleed', '12px'], ['--sidebar-edge', 'none'], ['--sidebar-divider', '1px solid #E2E2E6'], ['--shell-gap', '12px'],
  ['--font-display', "'Anthropic Serif', Georgia, 'Times New Roman', serif"],
  ['--font-body', "'Anthropic Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"],
  ['--font-mono', "'Anthropic Mono', 'Cascadia Code', Consolas, monospace"],
  ['--weight-display', '500'], ['--tracking-display', '-0.01em'],
];

test.each(SPEC)('%s has the spec value', (token, value) => {
  expect(declared('workbench.css', token)).toBe(value);
});

test('shared tokens: flags, deck colours and the type scale', () => {
  const flags = ['#D32F2F', '#F08A24', '#1E9E4A', '#2F6FCE', '#E0559A', '#1AA6A6', '#7A4FD0'];
  const decks = ['#1E7D32', '#B5651D', '#2F5FCE', '#B3261E', '#7A4FD0', '#1AA6A6', '#C28A00', '#E0559A'];
  flags.forEach((c, i) => expect(declared('tokens.css', `--flag-${i + 1}`)).toBe(c));
  decks.forEach((c, i) => expect(declared('tokens.css', `--deck-${i + 1}`)).toBe(c));
  const scale = [['label', '11.5px'], ['sm', '12.5px'], ['ui', '13.5px'], ['body', '15px'], ['lg', '17px'], ['xl', '19px'], ['2xl', '25px'], ['3xl', '30px'], ['4xl', '38px']];
  for (const [n, v] of scale) expect(declared('tokens.css', `--fs-${n}`)).toBe(v);
});

test('the Light theme is the only theme and is scoped by data-theme', () => {
  expect(readdirSync(THEME).filter((f) => f.endsWith('.css') && !['tokens.css', 'fonts.css'].includes(f))).toEqual(['workbench.css']);
  expect(read('workbench.css')).toContain("[data-theme='workbench']");
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
