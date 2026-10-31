import { expect, test } from 'vitest';
import { UndoStack } from '../../src/services/undo';

test('pops newest first and keeps only the newest 30', () => {
  const s = new UndoStack();
  for (let i = 1; i <= 35; i++) s.push({ label: `a${i}`, restore: [] });
  expect(s.size).toBe(30);
  expect(s.pop()!.label).toBe('a35');
  for (let i = 0; i < 29; i++) s.pop();
  expect(s.pop()).toBeUndefined();
});
