import { expect, test } from 'vitest';

test('test runner uses UK time', () => {
  expect(new Date('2026-07-01T12:00:00Z').getHours()).toBe(13); // BST
});
