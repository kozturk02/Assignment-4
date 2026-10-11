const { getAssurance } = require('./assurance');

function money(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function readRun(db, runId) {
  const row = db.get('SELECT * FROM runs WHERE id=?', runId);
  if (!row) throw Object.assign(new Error('Run not found.'), { status: 404 });
  const { configJson, ...run } = row;
  return { ...run, config: JSON.parse(configJson) };
}

function productResults(db, runId) {
  const products = db.all('SELECT * FROM run_products WHERE runId=? ORDER BY productId', runId);
  const sales = db.all(`SELECT productId, SUM(quantity) unitsSold, SUM(lineTotalCents) revenueCents,
    SUM(lineCostCents) cogsCents FROM transaction_items WHERE runId=? GROUP BY productId`, runId);
  const movements = db.all(`SELECT productId,
    SUM(CASE WHEN type='receipt' THEN quantity ELSE 0 END) receivedUnits,
    SUM(CASE WHEN type='expiry' THEN -quantity ELSE 0 END) expiredUnits,
    SUM(CASE WHEN type='expiry' THEN valueCents ELSE 0 END) writeOffCents,
    SUM(quantity) closingQuantity FROM inventory_events WHERE runId=? GROUP BY productId`, runId);
  const orders = db.all(`SELECT productId, SUM(quantity) orderedUnits, SUM(costCents) replenishmentCents
    FROM orders WHERE runId=? GROUP BY productId`, runId);
  const requests = db.all(`SELECT productId, SUM(requestedQuantity) requestedUnits,
    SUM(missedQuantity) missedUnits FROM customer_requests WHERE runId=? GROUP BY productId`, runId);
  const alerts = db.all(`SELECT productId,
    SUM(type='sold_out') stockoutDays, SUM(type='low_stock') lowStockDays,
    SUM(type='slow_mover') slowMoverDays FROM alerts WHERE runId=? GROUP BY productId`, runId);

  const lookups = [sales, movements, orders, requests, alerts].map(rows => new Map(rows.map(row => [row.productId, row])));
  return products.map(product => {
    const { runId: ignored, ...fields } = product;
    const row = { ...fields, unitsSold: 0, revenueCents: 0, cogsCents: 0, receivedUnits: 0,
      expiredUnits: 0, writeOffCents: 0, closingQuantity: 0, orderedUnits: 0,
      replenishmentCents: 0, requestedUnits: 0, missedUnits: 0,
      stockoutDays: 0, lowStockDays: 0, slowMoverDays: 0 };
    for (const lookup of lookups) Object.assign(row, lookup.get(product.productId) || {});
    row.grossProfitCents = row.revenueCents - row.cogsCents;
    row.closingValueCents = row.closingQuantity * row.unitCostCents;
    row.fulfilmentPercent = row.requestedUnits ? (row.requestedUnits - row.missedUnits) / row.requestedUnits * 100 : 100;
    return row;
  });
}

function operationalCases(db, runId) {
  const rows = db.all(`SELECT a.*, p.name FROM alerts a JOIN run_products p
    ON p.runId=a.runId AND p.productId=a.productId WHERE a.runId=? ORDER BY a.id`, runId)
    .map(({ detailsJson, ...row }) => ({ ...row, details: JSON.parse(detailsJson) }));
  const cases = [];
  for (const type of ['sold_out', 'expiry', 'slow_mover', 'cash_constraint']) {
    const matching = rows.filter(row => row.type === type).sort((a, b) =>
      (b.details.writeOffCents || b.details.unfilledQuantity || b.details.missedUnits || b.details.stock || 0) -
      (a.details.writeOffCents || a.details.unfilledQuantity || a.details.missedUnits || a.details.stock || 0));
    if (!matching.length) continue;
    const row = matching[0];
    const nextDay = row.day < 60 ? db.get('SELECT * FROM daily_stock WHERE runId=? AND day=? AND productId=?',
      runId, row.day + 1, row.productId) : null;
    const order = row.details.orderId ? db.get('SELECT * FROM orders WHERE runId=? AND id=?', runId, row.details.orderId) : null;
    let outcome = type === 'expiry'
      ? `${row.details.quantity} units were removed; ${money(row.details.writeOffCents)} was written off at purchase cost.`
      : row.day === 60 ? 'This is the final closing position; there is no Day 61 order or receipt.'
        : nextDay ? `On Day ${row.day + 1}, ${nextDay.receivedQuantity} units arrived, ${nextDay.soldQuantity} sold, ` +
          `${nextDay.missedQuantity} requested units were missed and ${nextDay.closingQuantity} ${nextDay.closingQuantity === 1 ? 'unit' : 'units'} remained.` : 'No following-day evidence is retained.';
    if (order) outcome = `Order ${order.id} cost ${money(order.costCents)} and was due on Day ${order.arrivalDay}. ${outcome}`;
    cases.push({ ...row, order, nextDay, outcome });
  }
  return cases;
}

function findings(db, runId, totals, products, categories, comparisons, cases) {
  const leadingCategory = [...categories].sort((a, b) => b.grossProfitCents - a.grossProfitCents)[0];
  const leadProduct = [...products].filter(product => product.category === leadingCategory.category)
    .sort((a, b) => b.revenueCents - a.revenueCents)[0];
  const leadDay = db.get(`SELECT t.day, SUM(i.lineTotalCents) revenue FROM transaction_items i
    JOIN transactions t ON t.id=i.transactionId WHERE i.runId=? AND i.productId=?
    GROUP BY t.day ORDER BY revenue DESC, t.day LIMIT 1`, runId, leadProduct.productId)?.day || 1;
  const perishables = products.filter(product => product.shelfLifeDays > 0);
  const perishableExpiry = perishables.reduce((sum, product) => sum + product.expiredUnits, 0);
  const perishableWriteOff = perishables.reduce((sum, product) => sum + product.writeOffCents, 0);
  const perishableMissed = perishables.reduce((sum, product) => sum + product.missedUnits, 0);
  const perishableCase = cases.find(row => row.type === 'expiry') || cases.find(row => row.type === 'sold_out');
  const share = totals.revenueCents ? leadingCategory.revenueCents / totals.revenueCents * 100 : 0;

  const result = [
    {
      title: 'Product mix drives gross profit',
      observation: `${leadingCategory.category} generated the largest category gross profit in this run.`,
      evidence: `${leadingCategory.unitsSold.toLocaleString('en-AU')} units, ${money(leadingCategory.revenueCents)} revenue ` +
        `(${share.toFixed(1)}% of store revenue), and ${money(leadingCategory.grossProfitCents)} gross profit. ` +
        `Weekdays averaged ${comparisons.weekday.averageCustomers.toFixed(1)} customers; weekends averaged ${comparisons.weekend.averageCustomers.toFixed(1)}.`,
      diagnosis: 'The assumed commuter, lunch and top-up missions shape category demand. Purchase costs and selling prices also determine gross profit.',
      implication: 'The range depends on the shopper assumptions. Gross profit excludes the costs of operating a real store.',
      recommendation: 'Pilot the location: count hourly visitors and measure baskets. Calibrate category preferences and margins before choosing the range.',
      limitation: 'No real customer history. Traffic, popularity and prices are assumed; demand does not respond to price changes.',
      day: leadDay, productId: leadProduct.productId
    },
    {
      title: 'Availability comes with a waste trade-off',
      observation: `Perishable products lost ${perishableExpiry.toLocaleString('en-AU')} units to expiry and missed ${perishableMissed.toLocaleString('en-AU')} requested units.`,
      evidence: `Perishable write-offs totalled ${money(perishableWriteOff)}. Across the whole range, ` +
        `${totals.missedUnits.toLocaleString('en-AU')} units of recorded demand were unfilled. ` +
        (perishableCase ? `${perishableCase.name} has an auditable ${perishableCase.type.replaceAll('_', ' ')} record on Day ${perishableCase.day}.` : 'The daily product positions retain both expiry and unfilled demand, including zero outcomes.'),
      diagnosis: 'Orders use recent requested demand and shelf-life limits. Next-day delivery cannot repair today\'s stockout; a seven-day average reacts slowly to demand changes.',
      implication: 'Lower orders reduce expiry risk but can miss sales. More stock could improve availability while increasing waste.',
      recommendation: 'Review the worst affected perishables. Test smaller opening quantities and a day-of-week stock allowance in a new run; compare missed demand with write-off cost.',
      limitation: 'Fixed shelf life and fresh receipts; no substitution, markdowns, delivery delays or refrigeration data.',
      day: perishableCase?.day || 1, productId: perishableCase?.productId || perishables[0]?.productId || products[0].productId
    }
  ];
  const inventoryRelease = totals.openingInventoryCents - totals.closingInventoryCents;
  result.push({
    title: 'Cash growth does not establish viability',
    observation: `The store closed with ${money(totals.closingCashCents)} operating cash and ${money(totals.closingInventoryCents)} inventory.`,
    evidence: `${money(totals.openingCashCents)} opening cash + ${money(totals.revenueCents)} sales - ` +
      `${money(totals.replenishmentCents)} orders = ${money(totals.closingCashCents)} closing cash. ` +
      `The cash change of ${money(totals.closingCashCents - totals.openingCashCents)} equals ` +
      `${money(totals.tradingResultCents)} inventory trading result plus ${money(inventoryRelease)} opening-to-closing inventory reduction.`,
    diagnosis: 'Sales are paid immediately; opening stock is funded separately and overheads are excluded. Target stock falls as Day 60 approaches.',
    implication: 'Cash growth partly reflects inventory drawdown and excluded expenses. It does not establish ongoing store viability.',
    recommendation: 'Add rent, utilities, hardware, delivery and payment costs to a feasibility model. Test ongoing replenishment and lower customer volumes using pilot data.',
    limitation: 'The run ends after 60 days and excludes overheads. Unused inventory funding is not cash; the closing position is not an ongoing-store forecast.',
    day: 60, productId: null
  });
  return result;
}

function getReport(db, runId) {
  const run = readRun(db, runId);
  const days = db.all('SELECT * FROM days WHERE runId=? ORDER BY day', runId);
  const products = productResults(db, runId);
  const sums = ['customers', 'transactions', 'unitsSold', 'requestedUnits', 'missedUnits', 'revenueCents',
    'cogsCents', 'writeOffUnits', 'writeOffCents', 'receivedUnits', 'replenishmentUnits', 'replenishmentCents'];
  const totals = Object.fromEntries(sums.map(field => [field, days.reduce((sum, day) => sum + day[field], 0)]));
  Object.assign(totals, {
    openingCashCents: run.openingCashCents, openingInventoryCents: run.openingInventoryCents,
    closingCashCents: days.at(-1)?.closingCashCents || run.openingCashCents,
    closingInventoryCents: products.reduce((sum, product) => sum + product.closingValueCents, 0),
    grossProfitCents: totals.revenueCents - totals.cogsCents,
    tradingResultCents: totals.revenueCents - totals.cogsCents - totals.writeOffCents,
    averageCustomers: days.length ? totals.customers / days.length : 0,
    averageBasketSize: totals.transactions ? totals.unitsSold / totals.transactions : 0,
    averageTransactionCents: totals.transactions ? totals.revenueCents / totals.transactions : 0,
    fulfilmentPercent: totals.requestedUnits ? totals.unitsSold / totals.requestedUnits * 100 : 100
  });
  const grouped = new Map();
  const categoryFields = ['unitsSold', 'revenueCents', 'cogsCents', 'grossProfitCents', 'expiredUnits',
    'writeOffCents', 'receivedUnits', 'orderedUnits', 'replenishmentCents', 'closingQuantity',
    'closingValueCents', 'missedUnits', 'stockoutDays', 'lowStockDays', 'slowMoverDays'];
  for (const product of products) {
    if (!grouped.has(product.category)) grouped.set(product.category,
      { category: product.category, ...Object.fromEntries(categoryFields.map(field => [field, 0])) });
    const category = grouped.get(product.category);
    for (const field of categoryFields) category[field] += product[field];
  }
  const categories = [...grouped.values()];
  const comparisons = {};
  for (const [name, weekend] of [['weekday', 0], ['weekend', 1]]) {
    const matching = days.filter(day => day.isWeekend === weekend);
    const customers = matching.reduce((sum, day) => sum + day.customers, 0);
    const transactions = matching.reduce((sum, day) => sum + day.transactions, 0);
    const revenueCents = matching.reduce((sum, day) => sum + day.revenueCents, 0);
    comparisons[name] = { days: matching.length, customers, transactions, revenueCents,
      averageCustomers: matching.length ? customers / matching.length : 0,
      averageRevenueCents: matching.length ? revenueCents / matching.length : 0 };
  }
  const eventCounts = Object.fromEntries(['low_stock', 'sold_out', 'expiry_warning', 'expiry', 'slow_mover',
    'replenishment', 'cash_constraint'].map(type => [type, 0]));
  for (const row of db.all('SELECT type, COUNT(*) count FROM alerts WHERE runId=? GROUP BY type', runId)) {
    eventCounts[row.type] = row.count;
  }
  const cases = operationalCases(db, runId);
  return {
    run, days, totals, products, categories, comparisons, eventCounts, cases,
    topProducts: [...products].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5),
    weakProducts: [...products].sort((a, b) => a.unitsSold - b.unitsSold).slice(0, 5),
    findings: findings(db, runId, totals, products, categories, comparisons, cases)
  };
}

function getDailyReport(db, runId, day) {
  const summary = db.get('SELECT * FROM days WHERE runId=? AND day=?', runId, day);
  if (!summary) throw Object.assign(new Error('Daily report not found.'), { status: 404 });
  return {
    summary,
    products: db.all(`SELECT s.*, p.name, p.category, p.unitCostCents, p.unitPriceCents, p.shelfLifeDays
      FROM daily_stock s JOIN run_products p ON p.runId=s.runId AND p.productId=s.productId
      WHERE s.runId=? AND s.day=? ORDER BY s.productId`, runId, day),
    alerts: db.all(`SELECT a.*, p.name FROM alerts a JOIN run_products p
      ON p.runId=a.runId AND p.productId=a.productId WHERE a.runId=? AND a.day=? ORDER BY a.id`, runId, day)
      .map(({ detailsJson, ...row }) => ({ ...row, details: JSON.parse(detailsJson) })),
    orders: db.all(`SELECT o.*, p.name FROM orders o JOIN run_products p
      ON p.runId=o.runId AND p.productId=o.productId WHERE o.runId=? AND o.day=? ORDER BY o.id`, runId, day)
  };
}

module.exports = { getReport, getDailyReport, getAssurance };
