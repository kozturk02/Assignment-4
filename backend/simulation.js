const { randomUUID, randomInt } = require('crypto');
const { getProducts, validateProducts } = require('./database');

const missions = [
  { name: 'Commute', weekdayWeight: 25, weekendWeight: 12, minLines: 1, maxLines: 2, doubleChance: 0.1,
    categories: { Drinks: 5, 'Ready to eat': 3, 'Fresh and bakery': 4, Snacks: 2, Chilled: 1 },
    hours: { 7: 4, 8: 5, 9: 3, 16: 2, 17: 4, 18: 3 } },
  { name: 'Lunch', weekdayWeight: 30, weekendWeight: 18, minLines: 2, maxLines: 3, doubleChance: 0.1,
    categories: { 'Ready to eat': 8, Drinks: 5, 'Fresh and bakery': 1, Snacks: 2, Chilled: 1 },
    hours: { 11: 2, 12: 5, 13: 5, 14: 2 } },
  { name: 'Top-up', weekdayWeight: 30, weekendWeight: 45, minLines: 3, maxLines: 7, doubleChance: 0.25,
    categories: { Pantry: 5, Chilled: 4, 'Fresh and bakery': 3, Household: 2, 'Personal care': 1, Drinks: 1, Snacks: 2 },
    hours: { 9: 1, 10: 1, 11: 1, 12: 1, 15: 2, 16: 3, 17: 4, 18: 4, 19: 3, 20: 2 } },
  { name: 'Convenience', weekdayWeight: 15, weekendWeight: 25, minLines: 1, maxLines: 3, doubleChance: 0.15,
    categories: { Drinks: 4, Snacks: 4, Household: 1, 'Personal care': 1, 'Ready to eat': 1, Chilled: 1, Pantry: 1 },
    hours: { 8: 1, 10: 1, 12: 1, 14: 1, 16: 2, 18: 2, 19: 2, 20: 3, 21: 3, 22: 2 } }
];

function getDefaultConfig() {
  return {
    modelVersion: '1.0', days: 60, startDate: '2026-08-03', seed: 42026,
    openingInventoryBudgetCents: 4000000, openingCashCents: 1500000,
    weekdayCustomers: 170, weekendCustomers: 110, demandVariation: 0.15,
    reorderDays: 1.5, targetDays: 4, observationDays: 7, slowMoverCoverDays: 14,
    expiryWarningDays: 2, leadTimeDays: 1, missions: structuredClone(missions)
  };
}

function validateConfig(input) {
  function fail(message) {
    throw Object.assign(new Error(message), { status: 400 });
  }
  const allowed = ['seed', 'startDate', 'weekdayCustomers', 'weekendCustomers', 'reorderDays', 'targetDays'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) {
    fail('Only seed, startDate, customer volumes and replenishment thresholds can be changed.');
  }
  const config = { ...getDefaultConfig(), ...input };
  if (input.seed === undefined) config.seed = randomInt(0, 4294967296);
  for (const field of ['weekdayCustomers', 'weekendCustomers']) {
    if (!Number.isInteger(config[field]) || config[field] < 20 || config[field] > 600) {
      fail(`${field} must be an integer between 20 and 600.`);
    }
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 4294967295) {
    fail('Seed must be an integer between 0 and 4294967295.');
  }
  if (typeof config.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(config.startDate) ||
      !Number.isFinite(Date.parse(`${config.startDate}T00:00:00Z`)) ||
      new Date(`${config.startDate}T00:00:00Z`).toISOString().slice(0, 10) !== config.startDate ||
      Number(config.startDate.slice(0, 4)) < 2000 || Number(config.startDate.slice(0, 4)) > 2100) {
    fail('Start date must be a valid calendar date between 2000 and 2100.');
  }
  if (typeof config.reorderDays !== 'number' || !Number.isFinite(config.reorderDays) ||
      config.reorderDays < 0.5 || config.reorderDays > 3 ||
      typeof config.targetDays !== 'number' || !Number.isFinite(config.targetDays) ||
      config.targetDays < config.reorderDays || config.targetDays > 14) {
    fail('Reorder cover must be 0.5-3 days. Target cover must be at least reorder cover and at most 14 days.');
  }
  return config;
}

// A small seeded generator makes the model easy to inspect and reproduce during testing.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weightedChoice(values, weight, random) {
  const total = values.reduce((sum, value) => sum + weight(value), 0);
  let remaining = random() * total;
  for (const value of values) {
    remaining -= weight(value);
    if (remaining < 0) return value;
  }
  return values[values.length - 1];
}

function runSimulation(db, input = {}) {
  const config = validateConfig(input);
  const products = validateProducts(getProducts(db));
  config.products = products;
  const runId = `RUN-${randomUUID()}`;
  const openingInventoryCents = products.reduce((sum, product) => sum + product.unitCostCents * product.initialQuantity, 0);
  const started = performance.now();
  const random = makeRandom(config.seed);

  db.transaction(() => {
    db.insert('runs', {
      id: runId, status: 'running', createdAt: new Date().toISOString(), completedAt: null,
      durationMs: null, openingInventoryCents, openingCashCents: config.openingCashCents,
      configJson: JSON.stringify(config)
    });
    products.forEach(product => db.insert('run_products', { runId, ...product }));

    let cash = config.openingCashCents;
    db.insert('cash_events', { runId, day: 0, type: 'opening', amountCents: cash,
      balanceCents: cash, transactionId: null, orderId: null });

    const stock = new Map(products.map(product => [product.productId, 0]));
    const batches = new Map(products.map(product => [product.productId, []]));
    const demandHistory = new Map(products.map(product => [product.productId, []]));
    const salesHistory = new Map(products.map(product => [product.productId, []]));
    const deliveries = new Map();

    function alert(day, product, type, condition, action, details = {}) {
      db.insert('alerts', { runId, day, productId: product.productId, type,
        condition, action, detailsJson: JSON.stringify(details) });
    }

    function movement(day, product, batch, type, quantity, transactionId = null) {
      stock.set(product.productId, stock.get(product.productId) + quantity);
      batch.remaining += quantity;
      db.insert('inventory_events', {
        runId, day, productId: product.productId, batchId: batch.id, type, quantity,
        stockAfter: stock.get(product.productId), batchAfter: batch.remaining,
        valueCents: Math.abs(quantity) * product.unitCostCents,
        transactionId, orderId: type === 'receipt' ? batch.orderId : null
      });
    }

    function receive(day, product, quantity, orderId = null) {
      if (!quantity) return;
      const receivedDay = day === 0 ? 1 : day;
      const row = { runId, productId: product.productId, receivedDay,
        expiryDay: product.shelfLifeDays ? receivedDay + product.shelfLifeDays : null,
        initialQuantity: quantity, unitCostCents: product.unitCostCents, orderId };
      const batch = { ...row, id: db.insert('batches', row), remaining: 0 };
      batches.get(product.productId).push(batch);
      movement(day, product, batch, day === 0 ? 'opening' : 'receipt', quantity);
    }

    products.forEach(product => receive(0, product, product.initialQuantity));

    for (let day = 1; day <= config.days; day++) {
      const date = new Date(`${config.startDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + day - 1);
      const isWeekend = [0, 6].includes(date.getUTCDay());
      const customerMean = isWeekend ? config.weekendCustomers : config.weekdayCustomers;
      const customerCount = Math.round(customerMean * (1 - config.demandVariation + random() * config.demandVariation * 2));
      const total = { runId, day, date: date.toISOString().slice(0, 10),
        weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()],
        isWeekend: Number(isWeekend), customers: customerCount, transactions: 0, unitsSold: 0,
        requestedUnits: 0, missedUnits: 0, revenueCents: 0, cogsCents: 0,
        writeOffUnits: 0, writeOffCents: 0, receivedUnits: 0, replenishmentUnits: 0,
        replenishmentCents: 0, openingCashCents: cash, closingCashCents: 0, closingInventoryCents: 0 };
      const positions = new Map(products.map(product => [product.productId, {
        runId, day, productId: product.productId, openingQuantity: stock.get(product.productId),
        receivedQuantity: 0, soldQuantity: 0, expiredQuantity: 0, requestedQuantity: 0,
        missedQuantity: 0, orderedQuantity: 0, closingQuantity: 0, closingValueCents: 0
      }]));

      // Deliveries arrive before expiry removal and customer activity.
      for (const order of deliveries.get(day) || []) {
        const product = products.find(value => value.productId === order.productId);
        receive(day, product, order.quantity, order.id);
        positions.get(product.productId).receivedQuantity += order.quantity;
        total.receivedUnits += order.quantity;
      }
      for (const product of products) {
        for (const batch of batches.get(product.productId)) {
          if (batch.remaining > 0 && batch.expiryDay !== null && batch.expiryDay <= day) {
            const quantity = batch.remaining;
            movement(day, product, batch, 'expiry', -quantity);
            positions.get(product.productId).expiredQuantity += quantity;
            total.writeOffUnits += quantity;
            total.writeOffCents += quantity * product.unitCostCents;
            alert(day, product, 'expiry', `${quantity} units reached expiry in batch ${batch.id}.`,
              'Removed the batch before customers arrived and recorded the purchase-cost write-off.',
              { batchId: batch.id, expiryDay: batch.expiryDay, quantity, writeOffCents: quantity * product.unitCostCents });
          }
        }
      }

      const visitors = Array.from({ length: customerCount }, () => {
        const mission = weightedChoice(config.missions,
          value => isWeekend ? value.weekendWeight : value.weekdayWeight, random);
        const hour = Number(weightedChoice(Object.keys(mission.hours), value => mission.hours[value], random));
        return { mission, hour };
      }).sort((a, b) => a.hour - b.hour);

      for (const visitor of visitors) {
        const { mission, hour } = visitor;
        const wantedLines = mission.minLines + Math.floor(random() * (mission.maxLines - mission.minLines + 1));
        const requests = [];
        const chosen = new Set();
        for (let line = 0; line < Math.min(wantedLines, products.length); line++) {
          const available = products.filter(product => !chosen.has(product.productId));
          const categories = [...new Set(available.map(product => product.category))];
          const matching = categories.filter(category => (mission.categories[category] || 0) > 0);
          let candidates = available;
          if (matching.length) {
            const category = weightedChoice(matching, value => mission.categories[value], random);
            candidates = available.filter(product => product.category === category);
          }
          const product = weightedChoice(candidates, value => value.popularity, random);
          chosen.add(product.productId);
          const requestedQuantity = random() < mission.doubleChance ? 2 : 1;
          const soldQuantity = Math.min(requestedQuantity, stock.get(product.productId));
          requests.push({ product, requestedQuantity, soldQuantity,
            missedQuantity: requestedQuantity - soldQuantity });
        }
        const requestedUnits = requests.reduce((sum, request) => sum + request.requestedQuantity, 0);
        const soldUnits = requests.reduce((sum, request) => sum + request.soldQuantity, 0);
        const customerId = db.insert('customers', { runId, day, hour, mission: mission.name,
          requestedUnits, soldUnits, missedUnits: requestedUnits - soldUnits });
        const revenueCents = requests.reduce((sum, request) => sum + request.soldQuantity * request.product.unitPriceCents, 0);
        const cogsCents = requests.reduce((sum, request) => sum + request.soldQuantity * request.product.unitCostCents, 0);
        const transactionId = soldUnits ? db.insert('transactions', { runId, day, hour, customerId,
          units: soldUnits, totalCents: revenueCents, cogsCents }) : null;

        for (const request of requests) {
          const { product, requestedQuantity, soldQuantity, missedQuantity } = request;
          db.insert('customer_requests', { runId, day, customerId, productId: product.productId,
            requestedQuantity, soldQuantity, missedQuantity });
          const position = positions.get(product.productId);
          position.requestedQuantity += requestedQuantity;
          position.soldQuantity += soldQuantity;
          position.missedQuantity += missedQuantity;
          let remaining = soldQuantity;
          // Oldest stock is sold first; all batches for a product share its declared shelf life.
          for (const batch of batches.get(product.productId)) {
            if (!remaining) break;
            if (!batch.remaining || (batch.expiryDay !== null && batch.expiryDay <= day)) continue;
            const quantity = Math.min(remaining, batch.remaining);
            db.insert('transaction_items', { runId, transactionId, productId: product.productId,
              batchId: batch.id, quantity, unitCostCents: product.unitCostCents,
              unitPriceCents: product.unitPriceCents, lineTotalCents: quantity * product.unitPriceCents,
              lineCostCents: quantity * product.unitCostCents });
            movement(day, product, batch, 'sale', -quantity, transactionId);
            remaining -= quantity;
          }
          if (remaining) throw new Error('Sale allocation exceeded available valid stock.');
        }
        if (transactionId) {
          cash += revenueCents;
          db.insert('cash_events', { runId, day, type: 'sale', amountCents: revenueCents,
            balanceCents: cash, transactionId, orderId: null });
          total.transactions++;
        }
        total.requestedUnits += requestedUnits;
        total.unitsSold += soldUnits;
        total.missedUnits += requestedUnits - soldUnits;
        total.revenueCents += revenueCents;
        total.cogsCents += cogsCents;
      }

      const reviews = products.map(product => {
        const position = positions.get(product.productId);
        const demand = demandHistory.get(product.productId);
        const sales = salesHistory.get(product.productId);
        demand.push(position.requestedQuantity);
        sales.push(position.soldQuantity);
        const windowDays = Math.min(day, config.observationDays);
        const averageDemand = demand.slice(-windowDays).reduce((sum, quantity) => sum + quantity, 0) / windowDays;
        const averageSales = sales.slice(-windowDays).reduce((sum, quantity) => sum + quantity, 0) / windowDays;
        const quantity = stock.get(product.productId);
        const lowThreshold = Math.max(2, Math.ceil(averageDemand * config.reorderDays));
        const slow = day >= config.observationDays && quantity > Math.max(10, averageSales * config.slowMoverCoverDays);
        const cover = Math.min(config.targetDays, config.days - day,
          product.shelfLifeDays ? Math.max(1, product.shelfLifeDays - 1) : config.targetDays);
        const targetQuantity = Math.ceil(averageDemand * cover);
        const wanted = quantity <= lowThreshold && !slow ? Math.max(0, targetQuantity - quantity) : 0;
        return { product, position, quantity, averageDemand, averageSales, lowThreshold, slow,
          targetQuantity, wanted, orderId: null, ordered: 0 };
      });

      // Prioritise sold-out products, then the lowest cover. Never spend money that is not available.
      const candidates = reviews.filter(review => review.wanted > 0 && day < config.days).sort((a, b) =>
        Number(b.quantity === 0) - Number(a.quantity === 0) ||
        a.quantity / Math.max(a.averageDemand, 0.01) - b.quantity / Math.max(b.averageDemand, 0.01) ||
        a.product.productId.localeCompare(b.product.productId));
      for (const review of candidates) {
        const { product, wanted } = review;
        const cashBeforeCents = cash;
        const quantity = Math.min(wanted, Math.floor(cash / product.unitCostCents));
        if (quantity) {
          const costCents = quantity * product.unitCostCents;
          cash -= costCents;
          const order = { runId, day, arrivalDay: day + 1, productId: product.productId,
            quantity, costCents, cashBeforeCents, cashAfterCents: cash,
            observedDailyDemand: review.averageDemand, stockBefore: review.quantity,
            targetQuantity: review.targetQuantity,
            reason: review.quantity === 0 ? 'Sold out: prioritise next-day availability.' : 'Low stock: restore target cover.' };
          review.orderId = db.insert('orders', order);
          review.ordered = quantity;
          review.position.orderedQuantity = quantity;
          if (!deliveries.has(day + 1)) deliveries.set(day + 1, []);
          deliveries.get(day + 1).push({ ...order, id: review.orderId });
          db.insert('cash_events', { runId, day, type: 'order', amountCents: -costCents,
            balanceCents: cash, transactionId: null, orderId: review.orderId });
          total.replenishmentUnits += quantity;
          total.replenishmentCents += costCents;
          alert(day, product, 'replenishment', order.reason,
            `Ordered ${quantity} units for Day ${day + 1}; cost deducted now.`,
            { orderId: review.orderId, quantity, costCents, arrivalDay: day + 1,
              stock: review.quantity, observedDailyDemand: review.averageDemand, targetQuantity: review.targetQuantity });
        }
        if (quantity < wanted) {
          alert(day, product, 'cash_constraint', `${wanted} units were needed but cash could fund ${quantity}.`,
            quantity ? 'Placed a smaller affordable order; the remaining need is unfilled.' : 'Deferred the order because available cash was insufficient.',
            { wantedQuantity: wanted, orderedQuantity: quantity, unfilledQuantity: wanted - quantity,
              cashBeforeCents, orderId: review.orderId });
        }
      }

      for (const review of reviews) {
        const { product, position, quantity, averageDemand, averageSales, lowThreshold, slow } = review;
        const response = review.ordered
          ? `Ordered ${review.ordered} units for Day ${day + 1}.`
          : day === config.days ? 'Recorded the closing condition. No order is placed after Day 60.'
            : review.wanted > 0 ? 'Could not fund the required order; cash constraint recorded.'
              : slow ? 'Held replenishment while existing stock sells down.'
                : 'Existing stock meets the shelf-life-limited target; monitor next day.';
        const details = { stock: quantity, lowThreshold, observedDailyDemand: averageDemand,
          observedDailySales: averageSales, missedUnits: position.missedQuantity,
          orderId: review.orderId, orderedQuantity: review.ordered };
        if (quantity === 0) {
          alert(day, product, 'sold_out', `No saleable units remain; ${position.missedQuantity} requested units were missed today.`, response, details);
        } else if (quantity <= lowThreshold) {
          alert(day, product, 'low_stock', `${quantity} units remain against a low-stock threshold of ${lowThreshold}.`, response, details);
        }
        if (slow) {
          alert(day, product, 'slow_mover', `${quantity} units remain with ${averageSales.toFixed(2)} average daily sales over the observation window.`,
            'Held replenishment and flagged excess stock for the remote manager.', details);
        }
        const nearExpiry = batches.get(product.productId).filter(batch => batch.remaining > 0 &&
          batch.expiryDay !== null && batch.expiryDay <= day + config.expiryWarningDays);
        const nearUnits = nearExpiry.reduce((sum, batch) => sum + batch.remaining, 0);
        if (nearUnits) {
          alert(day, product, 'expiry_warning', `${nearUnits} units will expire within ${config.expiryWarningDays} days.`,
            'Keep oldest stock first in the sales queue; remove any remaining units on their expiry day. No discount is assumed.',
            { quantity: nearUnits, batchIds: nearExpiry.map(batch => batch.id),
              earliestExpiryDay: Math.min(...nearExpiry.map(batch => batch.expiryDay)) });
        }
        position.closingQuantity = quantity;
        position.closingValueCents = quantity * product.unitCostCents;
        total.closingInventoryCents += position.closingValueCents;
        db.insert('daily_stock', position);
      }
      total.closingCashCents = cash;
      db.insert('days', total);
    }

    db.run('UPDATE runs SET status=?, completedAt=?, durationMs=? WHERE id=?',
      'completed', new Date().toISOString(), Math.round(performance.now() - started), runId);
    // Creating later runs keeps the selected Submitted Run unchanged.
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', 'submittedRunId', runId);
  });

  const { configJson, ...run } = db.get('SELECT * FROM runs WHERE id=?', runId);
  return { ...run, config: JSON.parse(configJson) };
}

module.exports = { getDefaultConfig, runSimulation };
