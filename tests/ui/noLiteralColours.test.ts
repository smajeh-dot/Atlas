import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Spec 8.1 rule 7: components get every colour from a token, so a dark theme is just another token file.
test('no literal colours outside the theme files', () => {
  const allowed = new Set(['tokens.css', 'workbench.css'].map((f) => join('src/ui/theme', f)));
  const files = [...walk('src/ui').filter((f) => /\.(css|tsx?)$/.test(f) && !allowed.has(f)), 'src/App.css'];
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
