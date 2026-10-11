const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { createDatabase, getProducts, validateProducts } = require('../database');
const { runSimulation } = require('../simulation');
const { getReport, getDailyReport, getAssurance } = require('../reports');
const { createApp } = require('../server');

function fixture(t) {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

function replaceDraft(db, products) {
  const validated = validateProducts(products);
  db.transaction(() => {
    db.run('DELETE FROM products');
    validated.forEach(product => db.insert('products', product));
  });
}

test('a 60-day run retains complete, reconcilable sales and next-day orders', t => {
  const db = fixture(t);
  const run = runSimulation(db, { seed: 42026 });
  const report = getReport(db, run.id);
  const assurance = getAssurance(db, run.id);
  assert.equal(run.status, 'completed');
  assert.equal(report.days.length, 60);
  assert.equal(report.products.length, 48);
  assert.ok(run.openingInventoryCents <= 4000000);
  assert.equal(run.openingCashCents, 1500000);
  assert.equal(assurance.status, 'PASS', JSON.stringify(assurance.checks));
  assert.equal(assurance.counts.dailyStockPositions, 48 * 60);
  assert.equal(report.totals.revenueCents, db.get('SELECT SUM(totalCents) total FROM transactions WHERE runId=?', run.id).total);
  assert.equal(report.totals.closingCashCents, 1500000 + report.totals.revenueCents - report.totals.replenishmentCents);
  assert.equal(report.totals.replenishmentUnits, report.totals.receivedUnits);
  assert.equal(db.get('SELECT COUNT(*) count FROM orders WHERE runId=? AND (arrivalDay<>day+1 OR day>=60)', run.id).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM inventory_events WHERE runId=? AND (stockAfter<0 OR batchAfter<0)', run.id).count, 0);
  assert.equal(getDailyReport(db, run.id, 60).orders.length, 0);
  assert.equal(report.findings.length, 3);
  for (const finding of report.findings) {
    for (const field of ['observation', 'evidence', 'diagnosis', 'implication', 'recommendation', 'limitation']) assert.ok(finding[field]);
  }
  assert.ok(report.eventCounts.sold_out > 0);
  assert.ok(report.eventCounts.expiry > 0);
  assert.ok(report.eventCounts.slow_mover > 0);
  assert.equal(report.eventCounts.cash_constraint, 0);
});

test('one-day shelf life removes unsold opening stock before Day 2 customers', t => {
  const db = fixture(t);
  const product = { ...getProducts(db)[0], initialQuantity: 100, shelfLifeDays: 1 };
  replaceDraft(db, [product]);
  const run = runSimulation(db, { seed: 4, weekdayCustomers: 20, weekendCustomers: 20 });
  const batch = db.get('SELECT * FROM batches WHERE runId=? AND orderId IS NULL', run.id);
  assert.equal(batch.receivedDay, 1);
  assert.equal(batch.expiryDay, 2);
  const expiry = db.get('SELECT * FROM inventory_events WHERE runId=? AND batchId=? AND type=?', run.id, batch.id, 'expiry');
  assert.equal(expiry.day, 2);
  assert.ok(expiry.quantity < 0);
  assert.equal(expiry.batchAfter, 0);
  assert.equal(db.get(`SELECT COUNT(*) count FROM transaction_items i JOIN transactions t ON t.id=i.transactionId
    WHERE i.batchId=? AND t.day>=2`, batch.id).count, 0);
  assert.equal(getAssurance(db, run.id).status, 'PASS');
});

test('cash pressure creates affordable partial or deferred orders without adding unused inventory funding', t => {
  const db = fixture(t);
  replaceDraft(db, getProducts(db).map(product => ({ ...product, initialQuantity: 0 })));
  const run = runSimulation(db, { seed: 9, weekdayCustomers: 600, weekendCustomers: 600, reorderDays: 3, targetDays: 14 });
  const firstDay = getDailyReport(db, run.id, 1);
  assert.equal(run.openingInventoryCents, 0);
  assert.equal(firstDay.summary.openingCashCents, 1500000);
  assert.equal(firstDay.summary.transactions, 0);
  assert.equal(firstDay.summary.unitsSold, 0);
  assert.ok(firstDay.summary.customers > 0);
  assert.ok(firstDay.summary.missedUnits > 0);
  assert.ok(firstDay.summary.replenishmentCents <= 1500000);
  assert.ok(db.get('SELECT COUNT(*) count FROM alerts WHERE runId=? AND type=?', run.id, 'cash_constraint').count > 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM orders WHERE runId=? AND costCents>cashBeforeCents', run.id).count, 0);
  assert.equal(getAssurance(db, run.id).status, 'PASS');
});

test('later catalogue changes and runs preserve completed history and the Submitted Run', t => {
  const db = fixture(t);
  const first = runSimulation(db, { seed: 23 });
  const originalConfig = db.get('SELECT configJson FROM runs WHERE id=?', first.id).configJson;
  const originalRevenue = getReport(db, first.id).totals.revenueCents;
  assert.throws(() => db.run('UPDATE days SET revenueCents=0 WHERE runId=?', first.id), /append-only/);
  assert.throws(() => db.run('DELETE FROM transactions WHERE runId=?', first.id), /append-only/);
  assert.throws(() => db.run('UPDATE runs SET configJson=? WHERE id=?', '{}', first.id), /frozen/);
  assert.throws(() => db.insert('alerts', { runId: first.id, day: 1, productId: 'P01', type: 'low_stock',
    condition: 'Attempt to add history', action: 'None', detailsJson: '{}' }), /frozen/);
  replaceDraft(db, getProducts(db).map(product => ({ ...product, initialQuantity: 1 })));
  const second = runSimulation(db, { seed: 24 });
  assert.notEqual(first.id, second.id);
  assert.equal(db.get('SELECT configJson FROM runs WHERE id=?', first.id).configJson, originalConfig);
  assert.equal(getReport(db, first.id).totals.revenueCents, originalRevenue);
  assert.equal(db.get('SELECT value FROM settings WHERE key=?', 'submittedRunId').value, first.id);
  assert.equal(getAssurance(db, first.id).status, 'PASS');
  assert.equal(getAssurance(db, second.id).status, 'PASS');
});

test('invalid budgets, runtime-stock fields and model settings are rejected before a run is written', t => {
  const db = fixture(t);
  const products = getProducts(db);
  assert.throws(() => validateProducts([{ ...products[0], unitCostCents: 100000, unitPriceCents: 100000, initialQuantity: 10000 }]), /40,000/);
  assert.throws(() => validateProducts([{ ...products[0], runtimeStock: 10 }]), /Runtime stock/);
  assert.throws(() => validateProducts([{ ...products[0], initialQuantity: 1.5 }]), /integer/);
  assert.throws(() => validateProducts([products[0], products[0]]), /unique/);
  for (const config of [{ openingCashCents: 5500000 }, { days: 30 }, { seed: -1 },
    { weekdayCustomers: '170' }, { startDate: '2026-02-30' }, { startDate: 'bad' },
    { reorderDays: 2, targetDays: 1 }, { targetDays: null }]) {
    assert.throws(() => runSimulation(db, config), error => error.status === 400);
  }
  assert.equal(db.get('SELECT COUNT(*) count FROM runs').count, 0);
});

test('assurance detects altered revenue, cash balances and expired batch sales independently', t => {
  const db = fixture(t);
  const run = runSimulation(db, { seed: 42026 });
  // These deliberate corruptions bypass the database guards only in an isolated in-memory test.
  db.exec('DROP TRIGGER days_no_update; DROP TRIGGER cash_events_no_update; DROP TRIGGER transaction_items_no_update;');
  db.run('UPDATE days SET revenueCents=revenueCents+1 WHERE runId=? AND day=1', run.id);
  let assurance = getAssurance(db, run.id);
  assert.equal(assurance.status, 'FAIL');
  assert.equal(assurance.checks.find(check => check.key === 'revenue').status, 'FAIL');
  db.run('UPDATE cash_events SET balanceCents=balanceCents+1 WHERE id=(SELECT MIN(id) FROM cash_events WHERE runId=? AND type=?)', run.id, 'sale');
  assurance = getAssurance(db, run.id);
  assert.equal(assurance.checks.find(check => check.key === 'cash').status, 'FAIL');
  const mismatch = db.get(`SELECT i.id itemId, b.id batchId FROM transaction_items i
    JOIN transactions t ON t.id=i.transactionId JOIN batches b ON b.runId=i.runId AND b.productId=i.productId
    WHERE i.runId=? AND b.orderId IS NULL AND b.expiryDay IS NOT NULL AND t.day>=b.expiryDay LIMIT 1`, run.id);
  assert.ok(mismatch);
  db.run('UPDATE transaction_items SET batchId=? WHERE id=?', mismatch.batchId, mismatch.itemId);
  assurance = getAssurance(db, run.id);
  assert.ok(assurance.metrics.expiredSales > 0);
  assert.equal(assurance.checks.find(check => check.key === 'inventory').status, 'FAIL');
});

test('the Submitted Run and all reports survive closing and reopening SQLite', t => {
  const filename = path.join(os.tmpdir(), `supermarket-test-${randomUUID()}.db`);
  let db = createDatabase(filename);
  t.after(() => { db.close(); if (fs.existsSync(filename)) fs.unlinkSync(filename); });
  const run = runSimulation(db, { seed: 45 });
  const revenue = getReport(db, run.id).totals.revenueCents;
  db.close();
  db = createDatabase(filename);
  assert.equal(db.get('SELECT value FROM settings WHERE key=?', 'submittedRunId').value, run.id);
  assert.equal(getReport(db, run.id).totals.revenueCents, revenue);
  assert.equal(getDailyReport(db, run.id, 1).summary.day, 1);
  assert.equal(getDailyReport(db, run.id, 60).summary.day, 60);
  assert.equal(getAssurance(db, run.id).status, 'PASS');
});

test('the HTTP API creates separate runs and exposes validated read-only evidence', async t => {
  const db = createDatabase(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: base } })).status, 200);
  assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'http://unrelated.invalid' } })).status, 403);
  const created = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 7 }) });
  assert.equal(created.status, 201);
  const run = await created.json();
  const prefix = `${base}/api/runs/${run.id}`;
  assert.equal((await (await fetch(`${base}/api/submitted-run`)).json()).id, run.id);
  assert.equal((await (await fetch(`${prefix}/assurance`)).json()).status, 'PASS');
  for (const day of [1, 60]) assert.equal((await fetch(`${prefix}/days/${day}`)).status, 200);
  const evidence = await (await fetch(`${prefix}/evidence/transactions?day=1&limit=2`)).json();
  assert.equal(evidence.rows.length, 2);
  assert.ok(evidence.total > 2);
  for (const [direction, sqlDirection] of [['ascending', 'ASC'], ['descending', 'DESC']]) {
    const sorted = await (await fetch(`${prefix}/evidence/transactions?sortBy=totalCents&sortDirection=${direction}&limit=5`)).json();
    const expected = db.all(`SELECT id FROM transactions WHERE runId=? ORDER BY totalCents ${sqlDirection}, id LIMIT 5`, run.id);
    assert.deepEqual(sorted.rows.map(row => row.id), expected.map(row => row.id));
    const next = await (await fetch(`${prefix}/evidence/transactions?sortBy=totalCents&sortDirection=${direction}&limit=5&offset=5`)).json();
    assert.equal(next.rows.length, 5);
    assert.ok(next.rows.every(row => !sorted.rows.some(previous => previous.id === row.id)));
    const products = await (await fetch(`${prefix}/evidence/stock?sortBy=productId&sortDirection=${direction}&limit=5`)).json();
    const names = db.all(`SELECT s.id FROM daily_stock s JOIN run_products p ON p.runId=s.runId AND p.productId=s.productId
      WHERE s.runId=? ORDER BY p.name COLLATE NOCASE ${sqlDirection}, s.id LIMIT 5`, run.id);
    assert.deepEqual(products.rows.map(row => row.id), names.map(row => row.id));
  }

  const details = await (await fetch(`${prefix}/transactions/${evidence.rows[0].id}`)).json();
  assert.ok(details.items.length > 0);
  assert.equal(details.cash.length, 1);
  assert.equal(details.items.reduce((sum, item) => sum + item.lineTotalCents, 0), details.totalCents);
  for (const suffix of ['/days/0', '/days/61', '/evidence/items?limit=0', '/evidence/items?day=1&day=2', '/evidence/cash?productId=P01', '/evidence/items?sortBy=runId', '/evidence/items?sortBy=id%3BDROP%20TABLE%20runs', '/evidence/items?sortDirection=wrong', '/evidence/items?sortBy=id&sortBy=quantity']) {
    assert.equal((await fetch(`${prefix}${suffix}`)).status, 400);
  }
  assert.equal((await fetch(`${prefix}/evidence/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/missing/report`)).status, 404);
  assert.equal((await fetch(`${prefix}/transactions/99999999`)).status, 404);
  assert.equal((await fetch(`${prefix}/days/1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(`${prefix}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400);
  const selected = await fetch(`${base}/api/submitted-run`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: run.id }) });
  assert.equal(selected.status, 200);
});
