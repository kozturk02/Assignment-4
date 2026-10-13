const test = require('node:test');
const assert = require('node:assert/strict');

test('table sorting uses numbers, natural alphabetical order, derived values and missing values without changing source rows', async () => {
  const { sortRows } = await import('../../frontend/src/components/tableSort.mjs');
  const rows = [{ name: 'Product 10', cents: 1200 }, { name: 'apple', cents: -50 }, { name: 'Product 2', cents: 90 }, { name: 'Banana', cents: null }];
  const original = structuredClone(rows);
  assert.deepEqual(sortRows(rows, { key: 'cents' }).map(row => row.cents), [-50, 90, 1200, null]);
  assert.deepEqual(sortRows(rows, { key: 'cents' }, 'descending').map(row => row.cents), [1200, 90, -50, null]);
  assert.deepEqual(sortRows(rows, { key: 'name' }).map(row => row.name), ['apple', 'Banana', 'Product 2', 'Product 10']);
  assert.deepEqual(sortRows(rows, { key: 'derived', sortValue: row => row.cents == null ? null : -row.cents }).map(row => row.cents), [1200, 90, -50, null]);
  assert.deepEqual(rows, original);
});
