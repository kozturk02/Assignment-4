function getAssurance(db, runId) {
  const run = db.get('SELECT * FROM runs WHERE id=?', runId);
  if (!run) throw Object.assign(new Error('Run not found.'), { status: 404 });

  const names = {
    history: 'Frozen configuration and complete history',
    inventory: 'Inventory, batches and sale availability',
    revenue: 'Transaction values and daily revenue',
    cash: 'Operating cash and affordable orders',
    shopping: 'Customer requests and completed baskets',
    operations: 'Delivery timing and Store Brain references'
  };
  const checks = Object.fromEntries(Object.entries(names).map(([key, name]) =>
    [key, { key, name, status: 'PASS', failureCount: 0, exceptions: [] }]));
  function issue(key, message) {
    const check = checks[key];
    check.status = 'FAIL';
    check.failureCount++;
    if (check.exceptions.length < 20) check.exceptions.push(message);
  }
  function rows(table) {
    return db.all(`SELECT * FROM ${table} WHERE runId=? ORDER BY ${table === 'run_products' ? 'productId' : 'id'}`, runId);
  }
  function add(map, key, value) {
    map.set(key, (map.get(key) || 0) + value);
  }
  const products = rows('run_products');
  const days = rows('days').sort((a, b) => a.day - b.day);
  const batches = rows('batches');
  const transactions = rows('transactions');
  const items = rows('transaction_items');
  const inventoryEvents = rows('inventory_events');
  const cashEvents = rows('cash_events');
  const orders = rows('orders');
  const customers = rows('customers');
  const requests = rows('customer_requests');
  const positions = rows('daily_stock');
  const alerts = rows('alerts');
  const counts = { days: days.length, products: products.length, batches: batches.length,
    customers: customers.length, customerRequests: requests.length, transactions: transactions.length,
    transactionItems: items.length, inventoryEvents: inventoryEvents.length, cashEvents: cashEvents.length,
    orders: orders.length, storeBrainRecords: alerts.length, dailyStockPositions: positions.length };
  const productMap = new Map(products.map(row => [row.productId, row]));
  const batchMap = new Map(batches.map(row => [row.id, row]));
  const transactionMap = new Map(transactions.map(row => [row.id, row]));
  const customerMap = new Map(customers.map(row => [row.id, row]));
  const orderMap = new Map(orders.map(row => [row.id, row]));
  const positionMap = new Map(positions.map(row => [`${row.day}|${row.productId}`, row]));
  const metrics = { negativeStock: 0, overselling: 0, expiredSales: 0, negativeCash: 0, unaffordableOrders: 0 };
  let config = {};
  try {
    config = JSON.parse(run.configJson);
    if (!config || typeof config !== 'object') config = {};
  } catch {
    issue('history', 'The frozen model declaration is not valid JSON.');
  }
  if (run.status !== 'completed') issue('history', 'The run is not completed.');
  if (days.length !== 60 || days.some((day, index) => day.day !== index + 1)) {
    issue('history', 'Exactly one retained record for each of Days 1-60 is required.');
  }
  if (counts.dailyStockPositions !== products.length * 60) issue('history', 'Daily product positions are incomplete.');
  if (!products.length || config.days !== 60 || config.openingCashCents !== 1500000 || run.openingCashCents !== 1500000) {
    issue('history', 'The run does not retain the required products, 60-day horizon and A$15,000 opening cash.');
  }
  const openingValue = products.reduce((sum, product) => sum + product.initialQuantity * product.unitCostCents, 0);
  if (openingValue > 4000000 || openingValue !== run.openingInventoryCents || config.openingInventoryBudgetCents !== 4000000) {
    issue('history', 'Opening inventory does not reconcile to the run or exceeds A$40,000.');
  }
  if (!Array.isArray(config.products) || config.products.length !== products.length) {
    issue('history', 'The frozen catalogue is missing or does not match the retained run products.');
  } else {
    for (const product of products) {
      const declared = config.products.find(row => row.productId === product.productId);
      if (!declared || Object.keys(declared).some(key => declared[key] !== product[key])) {
        issue('history', `Frozen product ${product.productId} does not match its run snapshot.`);
      }
    }
  }
  for (const day of days) {
    const date = new Date(`${config.startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day.day - 1);
    if (!Number.isFinite(date.getTime()) || day.date !== date.toISOString().slice(0, 10) ||
        day.isWeekend !== Number([0, 6].includes(date.getUTCDay())) ||
        day.weekday !== ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]) {
      issue('history', `Day ${day.day}: calendar fields contradict the frozen start date.`);
    }
  }

  const itemUnits = new Map();
  const itemRevenue = new Map();
  const itemCosts = new Map();
  const saleAllocations = new Map();
  const customerProductSales = new Map();
  for (const item of items) {
    const transaction = transactionMap.get(item.transactionId);
    const product = productMap.get(item.productId);
    const batch = batchMap.get(item.batchId);
    if (!transaction || !product || !batch || batch.productId !== item.productId) {
      issue('inventory', `Item ${item.id}: transaction, catalogue product or matching batch is missing.`);
      continue;
    }
    if (transaction.day < batch.receivedDay) issue('inventory', `Item ${item.id} was sold before its batch arrived.`);
    if (batch.expiryDay !== null && transaction.day >= batch.expiryDay) {
      metrics.expiredSales++;
      issue('inventory', `Item ${item.id}, Day ${transaction.day}: an expired batch was sold.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
        item.unitCostCents !== product.unitCostCents || item.unitPriceCents !== product.unitPriceCents ||
        item.lineTotalCents !== item.quantity * product.unitPriceCents ||
        item.lineCostCents !== item.quantity * product.unitCostCents) {
      issue('revenue', `Item ${item.id}: quantity, price or line value is inconsistent.`);
    }
    add(itemUnits, item.transactionId, item.quantity);
    add(itemRevenue, item.transactionId, item.lineTotalCents);
    add(itemCosts, item.transactionId, item.lineCostCents);
    add(saleAllocations, `${item.transactionId}|${item.productId}|${item.batchId}`, item.quantity);
    add(customerProductSales, `${transaction.customerId}|${item.productId}`, item.quantity);
  }

  const dailyRevenue = new Map();
  const dailyCosts = new Map();
  const dailyUnits = new Map();
  const dailyTransactions = new Map();
  const customerTransactions = new Map();
  for (const transaction of transactions) {
    const customer = customerMap.get(transaction.customerId);
    if (!customer || customer.day !== transaction.day || customer.hour !== transaction.hour ||
        customer.soldUnits !== transaction.units || customerTransactions.has(transaction.customerId)) {
      issue('shopping', `Transaction ${transaction.id}: customer identity, day, hour or basket is inconsistent.`);
    }
    if (transaction.units <= 0 || (itemUnits.get(transaction.id) || 0) !== transaction.units ||
        (itemRevenue.get(transaction.id) || 0) !== transaction.totalCents ||
        (itemCosts.get(transaction.id) || 0) !== transaction.cogsCents) {
      issue('revenue', `Transaction ${transaction.id}: recorded totals do not match its retained items.`);
    }
    customerTransactions.set(transaction.customerId, transaction);
    add(dailyRevenue, transaction.day, transaction.totalCents);
    add(dailyCosts, transaction.day, transaction.cogsCents);
    add(dailyUnits, transaction.day, transaction.units);
    add(dailyTransactions, transaction.day, 1);
  }

  // Replay the stock ledger in recorded order. This catches overselling even if the final total is positive.
  const stock = new Map(products.map(product => [product.productId, 0]));
  const batchStock = new Map(batches.map(batch => [batch.id, 0]));
  const inventoryTotals = new Map(products.map(product => [product.productId,
    { opening: 0, received: 0, sold: 0, expired: 0 }]));
  const movementsByDay = new Map();
  const ledgerSales = new Map();
  const acquisitions = new Map();
  const receiptsByOrder = new Map();
  const receivedByDay = new Map();
  const expiredByDay = new Map();
  const writeOffByDay = new Map();
  for (const event of inventoryEvents) {
    if (!movementsByDay.has(event.day)) movementsByDay.set(event.day, []);
    movementsByDay.get(event.day).push(event);
  }
  for (let day = 0; day <= 60; day++) {
    const openingStock = new Map(stock);
    const dayProduct = new Map();
    for (const event of movementsByDay.get(day) || []) {
      const product = productMap.get(event.productId);
      const batch = batchMap.get(event.batchId);
      if (!product || !batch || batch.productId !== event.productId) {
        issue('inventory', `Movement ${event.id}: matching product or batch is missing.`);
        continue;
      }
      const previousBatch = batchStock.get(batch.id);
      const nextBatch = previousBatch + event.quantity;
      const nextStock = stock.get(product.productId) + event.quantity;
      batchStock.set(batch.id, nextBatch);
      stock.set(product.productId, nextStock);
      if (nextBatch < 0 || nextStock < 0) {
        metrics.negativeStock++;
        if (event.type === 'sale') metrics.overselling++;
        issue('inventory', `Movement ${event.id}, Day ${day}: stock fell below zero.`);
      }
      if (event.stockAfter !== nextStock || event.batchAfter !== nextBatch ||
          event.valueCents !== Math.abs(event.quantity) * product.unitCostCents || event.quantity === 0) {
        issue('inventory', `Movement ${event.id}: balances or purchase-cost value disagree with the ledger.`);
      }
      const total = inventoryTotals.get(product.productId);
      const key = `${product.productId}|${event.type}`;
      add(dayProduct, key, Math.abs(event.quantity));
      if (['opening', 'receipt'].includes(event.type)) {
        if (event.quantity <= 0 || event.quantity !== batch.initialQuantity || previousBatch !== 0) {
          issue('inventory', `Movement ${event.id}: invalid or repeated batch acquisition.`);
        }
        add(acquisitions, batch.id, 1);
        if (event.type === 'opening') {
          total.opening += event.quantity;
          if (day !== 0 || batch.receivedDay !== 1 || batch.orderId !== null) {
            issue('inventory', `Movement ${event.id}: opening stock timing or funding is invalid.`);
          }
        } else {
          total.received += event.quantity;
          add(receivedByDay, day, event.quantity);
          const order = orderMap.get(event.orderId);
          if (!order || order.productId !== product.productId || order.arrivalDay !== day ||
              order.quantity !== event.quantity || batch.orderId !== order.id || batch.receivedDay !== day) {
            issue('operations', `Receipt ${event.id}: it does not match its next-day order.`);
          }
          add(receiptsByOrder, event.orderId, event.quantity);
        }
      } else {
        if (event.quantity >= 0) issue('inventory', `Movement ${event.id}: sale or expiry must reduce stock.`);
        if (event.type === 'sale') {
          total.sold -= event.quantity;
          const transaction = transactionMap.get(event.transactionId);
          if (!transaction || transaction.day !== day || day < batch.receivedDay ||
              (batch.expiryDay !== null && day >= batch.expiryDay)) {
            issue('inventory', `Sale movement ${event.id}: transaction or batch availability is invalid.`);
          }
          add(ledgerSales, `${event.transactionId}|${event.productId}|${event.batchId}`, -event.quantity);
        } else if (event.type === 'expiry') {
          total.expired -= event.quantity;
          add(expiredByDay, day, -event.quantity);
          add(writeOffByDay, day, event.valueCents);
          if (batch.expiryDay === null || day < batch.expiryDay || nextBatch !== 0 || event.transactionId !== null) {
            issue('inventory', `Expiry movement ${event.id}: timing or full batch removal is invalid.`);
          }
        }
      }
    }
    if (day > 0) {
      for (const product of products) {
        const position = positionMap.get(`${day}|${product.productId}`);
        if (!position) {
          issue('inventory', `Day ${day}, ${product.productId}: closing position is missing.`);
          continue;
        }
        const received = dayProduct.get(`${product.productId}|receipt`) || 0;
        const sold = dayProduct.get(`${product.productId}|sale`) || 0;
        const expired = dayProduct.get(`${product.productId}|expiry`) || 0;
        if (position.openingQuantity !== openingStock.get(product.productId) ||
            position.receivedQuantity !== received || position.soldQuantity !== sold ||
            position.expiredQuantity !== expired || position.closingQuantity !== stock.get(product.productId) ||
            position.closingValueCents !== stock.get(product.productId) * product.unitCostCents ||
            position.openingQuantity + received - sold - expired !== position.closingQuantity) {
          issue('inventory', `Day ${day}, ${product.productId}: the daily stock position does not reconcile.`);
        }
      }
      for (const batch of batches) {
        if (batch.expiryDay !== null && batch.expiryDay <= day && batchStock.get(batch.id) > 0) {
          issue('inventory', `Day ${day}, batch ${batch.id}: expired stock remained available.`);
        }
      }
    }
  }
  for (const batch of batches) {
    const product = productMap.get(batch.productId);
    if (!product || acquisitions.get(batch.id) !== 1 || batch.unitCostCents !== product.unitCostCents ||
        batch.expiryDay !== (product.shelfLifeDays ? batch.receivedDay + product.shelfLifeDays : null)) {
      issue('inventory', `Batch ${batch.id}: acquisition, cost or shelf life is inconsistent.`);
    }
  }
  for (const key of new Set([...saleAllocations.keys(), ...ledgerSales.keys()])) {
    if ((saleAllocations.get(key) || 0) !== (ledgerSales.get(key) || 0)) {
      issue('inventory', `Transaction/product/batch ${key}: sold items do not match stock deductions.`);
    }
  }
  const inventory = products.map(product => {
    const totals = inventoryTotals.get(product.productId);
    const closing = stock.get(product.productId);
    const expected = product.initialQuantity + totals.received - totals.sold - totals.expired;
    if (totals.opening !== product.initialQuantity || expected !== closing) {
      issue('inventory', `Product ${product.productId}: opening + receipts - sales - expiry differs from closing stock.`);
    }
    return { productId: product.productId, name: product.name, opening: product.initialQuantity,
      received: totals.received, sold: totals.sold, expired: totals.expired,
      expectedClosing: expected, recordedClosing: positionMap.get(`60|${product.productId}`)?.closingQuantity ?? null,
      ledgerClosing: closing, difference: closing - expected };
  });

  const requestTotals = new Map();
  const requestProductSales = new Map();
  const requestedByDay = new Map();
  const missedByDay = new Map();
  const customerCountsByDay = new Map();
  const requestsByPosition = new Map();
  const missedByPosition = new Map();
  for (const request of requests) {
    const customer = customerMap.get(request.customerId);
    if (!customer || customer.day !== request.day || !productMap.has(request.productId) ||
        !Number.isSafeInteger(request.requestedQuantity) || request.requestedQuantity <= 0 ||
        request.soldQuantity < 0 || request.soldQuantity > request.requestedQuantity ||
        request.missedQuantity !== request.requestedQuantity - request.soldQuantity) {
      issue('shopping', `Request ${request.id}: identity, demand or fulfilment is inconsistent.`);
    }
    if (!requestTotals.has(request.customerId)) requestTotals.set(request.customerId, { requested: 0, sold: 0, missed: 0 });
    const total = requestTotals.get(request.customerId);
    total.requested += request.requestedQuantity;
    total.sold += request.soldQuantity;
    total.missed += request.missedQuantity;
    add(requestProductSales, `${request.customerId}|${request.productId}`, request.soldQuantity);
    add(requestedByDay, request.day, request.requestedQuantity);
    add(missedByDay, request.day, request.missedQuantity);
    add(requestsByPosition, `${request.day}|${request.productId}`, request.requestedQuantity);
    add(missedByPosition, `${request.day}|${request.productId}`, request.missedQuantity);
  }
  for (const customer of customers) {
    const total = requestTotals.get(customer.id);
    const transaction = customerTransactions.get(customer.id);
    if (!total || total.requested !== customer.requestedUnits || total.sold !== customer.soldUnits ||
        total.missed !== customer.missedUnits || Boolean(transaction) !== (customer.soldUnits > 0) ||
        !(config.missions || []).some(mission => mission.name === customer.mission && Object.hasOwn(mission.hours, customer.hour))) {
      issue('shopping', `Customer ${customer.id}: mission, requests or transaction is inconsistent.`);
    }
    add(customerCountsByDay, customer.day, 1);
  }
  for (const key of new Set([...requestProductSales.keys(), ...customerProductSales.keys()])) {
    if ((requestProductSales.get(key) || 0) !== (customerProductSales.get(key) || 0)) {
      issue('shopping', `Customer/product ${key}: fulfilled requests do not match sold items.`);
    }
  }

  const spendingByDay = new Map();
  const orderedUnitsByDay = new Map();
  const orderedByPosition = new Map();
  for (const order of orders) {
    const product = productMap.get(order.productId);
    if (!product || order.quantity <= 0 || order.costCents !== order.quantity * product.unitCostCents ||
        order.day < 1 || order.day >= 60 || order.arrivalDay !== order.day + 1 ||
        receiptsByOrder.get(order.id) !== order.quantity) {
      issue('operations', `Order ${order.id}: quantity, cost, horizon or next-day receipt is inconsistent.`);
    }
    if (order.costCents > order.cashBeforeCents || order.cashAfterCents < 0) {
      metrics.unaffordableOrders++;
      issue('cash', `Order ${order.id} exceeds the cash available when placed.`);
    }
    add(spendingByDay, order.day, order.costCents);
    add(orderedUnitsByDay, order.day, order.quantity);
    add(orderedByPosition, `${order.day}|${order.productId}`, order.quantity);
  }
  for (const position of positions) {
    const key = `${position.day}|${position.productId}`;
    if (position.requestedQuantity !== (requestsByPosition.get(key) || 0) ||
        position.missedQuantity !== (missedByPosition.get(key) || 0)) issue('shopping', `Day/product ${key}: recorded demand differs from customer requests.`);
    if (position.orderedQuantity !== (orderedByPosition.get(key) || 0)) issue('operations', `Day/product ${key}: ordered quantity differs from retained orders.`);
  }

  let cashBalance = 0;
  let openingCashEvents = 0;
  const saleCashCounts = new Map();
  const orderCashCounts = new Map();
  const closingCashByDay = new Map();
  let lastCashDay = -1;
  for (const event of cashEvents) {
    const cashBefore = cashBalance;
    cashBalance += event.amountCents;
    if (event.day < lastCashDay || event.balanceCents !== cashBalance) issue('cash', `Cash event ${event.id}: recorded balance or day sequence is inconsistent.`);
    lastCashDay = event.day;
    if (cashBalance < 0) {
      metrics.negativeCash++;
      issue('cash', `Cash event ${event.id}: operating cash became negative.`);
    }
    if (event.type === 'opening') {
      openingCashEvents++;
      if (event.day !== 0 || cashBefore !== 0 || event.amountCents !== 1500000) issue('cash', 'Opening cash must be exactly A$15,000 before Day 1.');
    } else if (event.type === 'sale') {
      const transaction = transactionMap.get(event.transactionId);
      if (!transaction || transaction.day !== event.day || event.amountCents !== transaction.totalCents || event.orderId !== null) {
        issue('cash', `Cash event ${event.id}: it does not match its sale.`);
      }
      add(saleCashCounts, event.transactionId, 1);
    } else if (event.type === 'order') {
      const order = orderMap.get(event.orderId);
      if (!order || order.day !== event.day || event.amountCents !== -order.costCents ||
          order.cashBeforeCents !== cashBefore || order.cashAfterCents !== cashBalance || event.transactionId !== null) {
        issue('cash', `Cash event ${event.id}: it does not match its order and available balance.`);
      }
      add(orderCashCounts, event.orderId, 1);
    }
    closingCashByDay.set(event.day, cashBalance);
  }
  if (openingCashEvents !== 1) issue('cash', 'Exactly one opening cash event is required.');
  for (const transaction of transactions) {
    if (saleCashCounts.get(transaction.id) !== 1) issue('cash', `Transaction ${transaction.id} needs exactly one cash receipt.`);
  }
  for (const order of orders) {
    if (orderCashCounts.get(order.id) !== 1) issue('cash', `Order ${order.id} needs exactly one cash deduction.`);
  }

  const revenue = [];
  let expectedCash = run.openingCashCents;
  let previousClosing = run.openingCashCents;
  for (const day of days) {
    const transactionRevenue = dailyRevenue.get(day.day) || 0;
    revenue.push({ day: day.day, recordedRevenueCents: day.revenueCents,
      transactionRevenueCents: transactionRevenue, differenceCents: day.revenueCents - transactionRevenue });
    if (day.revenueCents !== transactionRevenue || day.cogsCents !== (dailyCosts.get(day.day) || 0) ||
        day.unitsSold !== (dailyUnits.get(day.day) || 0) || day.transactions !== (dailyTransactions.get(day.day) || 0)) {
      issue('revenue', `Day ${day.day}: revenue, COGS, units or transaction count does not match transactions.`);
    }
    if (day.customers !== (customerCountsByDay.get(day.day) || 0) || day.requestedUnits !== (requestedByDay.get(day.day) || 0) ||
        day.missedUnits !== (missedByDay.get(day.day) || 0)) issue('shopping', `Day ${day.day}: customer or demand totals do not reconcile.`);
    const inventoryValue = products.reduce((sum, product) => sum + (positionMap.get(`${day.day}|${product.productId}`)?.closingValueCents || 0), 0);
    if (day.writeOffUnits !== (expiredByDay.get(day.day) || 0) || day.writeOffCents !== (writeOffByDay.get(day.day) || 0) ||
        day.receivedUnits !== (receivedByDay.get(day.day) || 0) || day.closingInventoryCents !== inventoryValue) {
      issue('inventory', `Day ${day.day}: expiry, receipts or closing inventory value do not reconcile.`);
    }
    const spending = spendingByDay.get(day.day) || 0;
    expectedCash += transactionRevenue - spending;
    const ledgerCash = closingCashByDay.get(day.day) ?? previousClosing;
    if (day.openingCashCents !== previousClosing || day.closingCashCents !== expectedCash || ledgerCash !== expectedCash ||
        day.replenishmentCents !== spending || day.replenishmentUnits !== (orderedUnitsByDay.get(day.day) || 0)) {
      issue('cash', `Day ${day.day}: cash or replenishment figures do not reconcile to sales and orders.`);
    }
    previousClosing = expectedCash;
  }
  const dailyRevenueCents = days.reduce((sum, day) => sum + day.revenueCents, 0);
  const transactionRevenueCents = transactions.reduce((sum, transaction) => sum + transaction.totalCents, 0);
  const lineRevenueCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  if (dailyRevenueCents !== transactionRevenueCents || lineRevenueCents !== transactionRevenueCents) issue('revenue', '60-day daily, transaction and item revenue totals disagree.');
  const replenishmentCents = orders.reduce((sum, order) => sum + order.costCents, 0);
  const expectedClosingCash = run.openingCashCents + transactionRevenueCents - replenishmentCents;
  const recordedClosingCash = days.at(-1)?.closingCashCents ?? null;
  if (cashBalance !== expectedClosingCash || recordedClosingCash !== expectedClosingCash) issue('cash', 'The 60-day closing cash equation does not reconcile.');

  const allowedTypes = ['low_stock', 'sold_out', 'expiry_warning', 'expiry', 'slow_mover', 'replenishment', 'cash_constraint'];
  for (const alert of alerts) {
    if (!productMap.has(alert.productId) || alert.day < 1 || alert.day > 60 || !allowedTypes.includes(alert.type)) {
      issue('operations', `Store Brain record ${alert.id}: product, day or condition type is invalid.`);
    }
    try {
      const details = JSON.parse(alert.detailsJson);
      if (details.orderId) {
        const order = orderMap.get(details.orderId);
        if (!order || order.productId !== alert.productId || order.day !== alert.day) {
          issue('operations', `Store Brain record ${alert.id} refers to an unrelated or missing order.`);
        }
      }
    } catch {
      issue('operations', `Store Brain record ${alert.id} has unreadable evidence details.`);
    }
  }

  const checkList = Object.values(checks);
  return {
    runId, status: checkList.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL',
    counts, checks: checkList, metrics, inventory, revenue,
    revenueTotals: { dailyRevenueCents, transactionRevenueCents, lineRevenueCents },
    cash: { openingCashCents: run.openingCashCents, salesRevenueCents: transactionRevenueCents,
      replenishmentCents, expectedClosingCents: expectedClosingCash,
      recordedClosingCents: recordedClosingCash, ledgerClosingCents: cashBalance,
      differenceCents: recordedClosingCash === null ? null : recordedClosingCash - expectedClosingCash },
    note: 'Stockouts, write-offs, slow movers and affordable cash-constrained orders are business outcomes. FAIL means the recorded evidence contains a contradiction. Checks are recalculated from SQLite when this view is requested.'
  };
}

module.exports = { getAssurance };
