import { expect, test } from 'vitest';
import { createTestDb } from '../helpers/testDb';

// The Rust bridge stores whole numbers as INTEGER; the test database must do the same.
test('whole numbers bind as INTEGER, fractions as REAL, booleans as 0/1', async () => {
  const db = createTestDb();
  const [r] = await db.query<Record<string, unknown>>('SELECT typeof(?) AS a, typeof(?) AS b, ? AS c, typeof(?) AS d', [5, 5.5, true, null]);
  expect(r).toEqual({ a: 'integer', b: 'real', c: 1, d: 'null' });
});
