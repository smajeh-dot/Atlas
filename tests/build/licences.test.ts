import { expect, test } from 'vitest';
import { collectLicences } from '../../vite.config';

test('collectLicences finds every bundled library and font with its licence text', () => {
  const all = collectLicences(process.cwd());
  const names = all.map((l) => l.name);
  for (const n of ['react', 'react-dom', 'dompurify', 'katex', '@tiptap/core', 'prosemirror-model', '@fontsource/dm-sans', 'ts-fsrs', '@tauri-apps/api', 'scheduler'])
    expect(names).toContain(n);
  expect(all.every((l) => l.text.trim().length > 0 && l.version.length > 0)).toBe(true);
  expect(names).not.toContain('vitest');
  expect(names).not.toContain('jsdom');
  expect(new Set(names).size).toBe(names.length);
  expect(all.find((l) => l.name === '@fontsource/dm-sans')!.licence).toBe('OFL-1.1');
});
