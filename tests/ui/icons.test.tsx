// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { Icon } from '../../src/ui/icons/icons';

test('supplied icons draw their paths; unsupplied ones render the dashed placeholder', () => {
  const { container: a } = render(<Icon name="today" />);
  expect(a.querySelector('svg path')).not.toBeNull();
  expect(a.querySelector('svg')!.getAttribute('width')).toBe('16');
  const { container: b } = render(<Icon name="suspend" />);
  expect(b.querySelector('[data-placeholder="true"]')).not.toBeNull();
  const { container: c } = render(<Icon name="today" size={18} />);
  expect(c.querySelector('svg')!.getAttribute('width')).toBe('18');
});

test('newDeck reuses the plus icon', () => {
  const d = (name: 'plus' | 'newDeck') => render(<Icon name={name} />).container.querySelector('path')!.getAttribute('d');
  expect(d('newDeck')).toBe(d('plus'));
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

test('no SVG path data outside the icon registry', () => {
  const offenders = walk('src').filter((f) => !f.endsWith('icons.tsx') && /<path\b|\bd="M/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
