const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function validateProducts(products) {
  function fail(message) {
    throw Object.assign(new Error(message), { status: 400 });
  }

  if (!Array.isArray(products) || products.length < 1 || products.length > 120) {
    fail('Provide between 1 and 120 products.');
  }

  const ids = new Set();
  const fields = ['productId', 'name', 'category', 'unitCostCents', 'unitPriceCents',
    'initialQuantity', 'shelfLifeDays', 'popularity', 'perishable'];

  const result = products.map(product => {
    if (!product || typeof product !== 'object' || Object.keys(product).some(key => !fields.includes(key))) {
      fail('Product data contains an unknown field. Runtime stock cannot be edited.');
    }
    for (const field of ['productId', 'name', 'category']) {
      if (typeof product[field] !== 'string' || !product[field].trim() || product[field].length > 100) {
        fail(`Each product needs a valid ${field}.`);
      }
    }
    if (!/^[A-Za-z0-9-]+$/.test(product.productId) || ids.has(product.productId)) {
      fail('Product IDs must be unique and contain only letters, numbers or hyphens.');
    }
    ids.add(product.productId);

    const ranges = { unitCostCents: [1, 100000], unitPriceCents: [1, 200000],
      initialQuantity: [0, 10000], shelfLifeDays: [0, 365] };
    for (const [field, [min, max]] of Object.entries(ranges)) {
      if (!Number.isSafeInteger(product[field]) || product[field] < min || product[field] > max) {
        fail(`${product.name}: ${field} must be an integer between ${min} and ${max}.`);
      }
    }
    if (product.unitPriceCents < product.unitCostCents) {
      fail(`${product.name}: selling price must cover purchase cost in this model.`);
    }
    if (typeof product.popularity !== 'number' || !Number.isFinite(product.popularity) ||
        product.popularity < 0.1 || product.popularity > 10) {
      fail(`${product.name}: popularity must be between 0.1 and 10.`);
    }
    if (product.perishable !== undefined && product.perishable !== (product.shelfLifeDays > 0)) {
      fail(`${product.name}: perishability must agree with shelf life.`);
    }
    return {
      productId: product.productId,
      name: product.name.trim(),
      category: product.category.trim(),
      unitCostCents: product.unitCostCents,
      unitPriceCents: product.unitPriceCents,
      initialQuantity: product.initialQuantity,
      shelfLifeDays: product.shelfLifeDays,
      popularity: product.popularity
    };
  });

  const cost = result.reduce((total, product) => total + product.unitCostCents * product.initialQuantity, 0);
  if (cost > 4000000) fail('Opening inventory must not exceed A$40,000.');
  return result;
}

function createDatabase(filename = path.join(__dirname, 'data', 'supermarket.db')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const connection = new Database(filename);
  connection.pragma('foreign_keys = ON');
  connection.pragma('journal_mode = DELETE');

  connection.exec(`
    CREATE TABLE IF NOT EXISTS products (
      productId TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      unitCostCents INTEGER NOT NULL CHECK(unitCostCents > 0),
      unitPriceCents INTEGER NOT NULL CHECK(unitPriceCents >= unitCostCents),
      initialQuantity INTEGER NOT NULL CHECK(initialQuantity >= 0),
      shelfLifeDays INTEGER NOT NULL CHECK(shelfLifeDays >= 0), popularity REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('running', 'completed')),
      createdAt TEXT NOT NULL, completedAt TEXT, durationMs INTEGER,
      openingInventoryCents INTEGER NOT NULL, openingCashCents INTEGER NOT NULL,
      configJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_products (
      runId TEXT NOT NULL REFERENCES runs(id), productId TEXT NOT NULL,
      name TEXT NOT NULL, category TEXT NOT NULL, unitCostCents INTEGER NOT NULL,
      unitPriceCents INTEGER NOT NULL, initialQuantity INTEGER NOT NULL,
      shelfLifeDays INTEGER NOT NULL, popularity REAL NOT NULL,
      PRIMARY KEY(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id),
      day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 60), date TEXT NOT NULL,
      weekday TEXT NOT NULL, isWeekend INTEGER NOT NULL,
      customers INTEGER NOT NULL, transactions INTEGER NOT NULL, unitsSold INTEGER NOT NULL,
      requestedUnits INTEGER NOT NULL, missedUnits INTEGER NOT NULL,
      revenueCents INTEGER NOT NULL, cogsCents INTEGER NOT NULL,
      writeOffUnits INTEGER NOT NULL, writeOffCents INTEGER NOT NULL,
      receivedUnits INTEGER NOT NULL, replenishmentUnits INTEGER NOT NULL,
      replenishmentCents INTEGER NOT NULL, openingCashCents INTEGER NOT NULL,
      closingCashCents INTEGER NOT NULL, closingInventoryCents INTEGER NOT NULL,
      UNIQUE(runId, day)
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      hour INTEGER NOT NULL, mission TEXT NOT NULL, requestedUnits INTEGER NOT NULL,
      soldUnits INTEGER NOT NULL, missedUnits INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      hour INTEGER NOT NULL, customerId INTEGER NOT NULL UNIQUE REFERENCES customers(id),
      units INTEGER NOT NULL CHECK(units > 0), totalCents INTEGER NOT NULL, cogsCents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      arrivalDay INTEGER NOT NULL, productId TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), costCents INTEGER NOT NULL,
      cashBeforeCents INTEGER NOT NULL, cashAfterCents INTEGER NOT NULL,
      observedDailyDemand REAL NOT NULL, stockBefore INTEGER NOT NULL,
      targetQuantity INTEGER NOT NULL, reason TEXT NOT NULL,
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), productId TEXT NOT NULL,
      receivedDay INTEGER NOT NULL, expiryDay INTEGER, initialQuantity INTEGER NOT NULL,
      unitCostCents INTEGER NOT NULL, orderId INTEGER UNIQUE REFERENCES orders(id),
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id),
      transactionId INTEGER NOT NULL REFERENCES transactions(id), productId TEXT NOT NULL,
      batchId INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL CHECK(quantity > 0),
      unitCostCents INTEGER NOT NULL, unitPriceCents INTEGER NOT NULL,
      lineTotalCents INTEGER NOT NULL, lineCostCents INTEGER NOT NULL,
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS customer_requests (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      customerId INTEGER NOT NULL REFERENCES customers(id), productId TEXT NOT NULL,
      requestedQuantity INTEGER NOT NULL, soldQuantity INTEGER NOT NULL, missedQuantity INTEGER NOT NULL,
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      productId TEXT NOT NULL, batchId INTEGER NOT NULL REFERENCES batches(id),
      type TEXT NOT NULL CHECK(type IN ('opening', 'receipt', 'sale', 'expiry')),
      quantity INTEGER NOT NULL, stockAfter INTEGER NOT NULL, batchAfter INTEGER NOT NULL,
      valueCents INTEGER NOT NULL, transactionId INTEGER REFERENCES transactions(id),
      orderId INTEGER REFERENCES orders(id),
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS cash_events (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('opening', 'sale', 'order')),
      amountCents INTEGER NOT NULL, balanceCents INTEGER NOT NULL,
      transactionId INTEGER REFERENCES transactions(id), orderId INTEGER REFERENCES orders(id)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      productId TEXT NOT NULL, type TEXT NOT NULL, condition TEXT NOT NULL,
      action TEXT NOT NULL, detailsJson TEXT NOT NULL,
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE TABLE IF NOT EXISTS daily_stock (
      id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), day INTEGER NOT NULL,
      productId TEXT NOT NULL, openingQuantity INTEGER NOT NULL, receivedQuantity INTEGER NOT NULL,
      soldQuantity INTEGER NOT NULL, expiredQuantity INTEGER NOT NULL,
      requestedQuantity INTEGER NOT NULL, missedQuantity INTEGER NOT NULL,
      orderedQuantity INTEGER NOT NULL, closingQuantity INTEGER NOT NULL, closingValueCents INTEGER NOT NULL,
      UNIQUE(runId, day, productId),
      FOREIGN KEY(runId, productId) REFERENCES run_products(runId, productId)
    );
    CREATE INDEX IF NOT EXISTS transactions_run_day ON transactions(runId, day);
    CREATE INDEX IF NOT EXISTS customers_run_day ON customers(runId, day);
    CREATE INDEX IF NOT EXISTS items_run_product ON transaction_items(runId, productId);
    CREATE INDEX IF NOT EXISTS items_transaction ON transaction_items(transactionId);
    CREATE INDEX IF NOT EXISTS requests_customer ON customer_requests(customerId);
    CREATE INDEX IF NOT EXISTS inventory_run_day ON inventory_events(runId, day);
    CREATE INDEX IF NOT EXISTS inventory_transaction ON inventory_events(transactionId);
    CREATE INDEX IF NOT EXISTS alerts_run_day ON alerts(runId, day);
    CREATE INDEX IF NOT EXISTS cash_run_day ON cash_events(runId, day);
    CREATE INDEX IF NOT EXISTS cash_transaction ON cash_events(transactionId);
    CREATE INDEX IF NOT EXISTS orders_run_day ON orders(runId, day);
  `);

  // Draft products can change. Recorded history only accepts inserts while a run is active.
  const historyTables = ['run_products', 'days', 'customers', 'transactions', 'orders', 'batches',
    'transaction_items', 'customer_requests', 'inventory_events', 'cash_events', 'alerts', 'daily_stock'];
  for (const table of historyTables) {
    connection.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'Simulation history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'Simulation history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_frozen BEFORE INSERT ON ${table}
      WHEN (SELECT status FROM runs WHERE id = NEW.runId) <> 'running'
      BEGIN SELECT RAISE(ABORT, 'Completed runs are frozen'); END;
    `);
  }
  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS runs_no_update BEFORE UPDATE ON runs WHEN OLD.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'Completed runs are frozen'); END;
    CREATE TRIGGER IF NOT EXISTS runs_no_delete BEFORE DELETE ON runs
    BEGIN SELECT RAISE(ABORT, 'Simulation history is append-only'); END;
  `);

  // Cache prepared statements because a run writes many small records in one transaction.
  const statements = new Map();
  function prepare(sql) {
    if (!statements.has(sql)) statements.set(sql, connection.prepare(sql));
    return statements.get(sql);
  }
  const db = {
    all: (sql, ...values) => prepare(sql).all(...values),
    get: (sql, ...values) => prepare(sql).get(...values),
    run: (sql, ...values) => prepare(sql).run(...values),
    exec: sql => connection.exec(sql),
    transaction: fn => connection.transaction(fn)(),
    close: () => connection.close(),
    insert(table, row) {
      const columns = Object.keys(row);
      const result = prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .run(...Object.values(row));
      return Number(result.lastInsertRowid);
    }
  };

  if (!db.get('SELECT productId FROM products LIMIT 1')) {
    const seed = validateProducts(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf8')));
    db.transaction(() => seed.forEach(product => db.insert('products', product)));
  }
  return db;
}

function getProducts(db) {
  return db.all('SELECT * FROM products ORDER BY productId');
}

module.exports = { createDatabase, getProducts, validateProducts };
