const express = require('express');
const path = require('path');
const fs = require('fs');

const {
  createDatabase,
  getProducts,
  validateProducts
} = require('./database');

const {
  getDefaultConfig,
  runSimulation
} = require('./simulation');

const {
  getReport,
  getDailyReport,
  getAssurance
} = require('./reports');

function createApp(db) {
  const app = express();

  app.disable('x-powered-by');

  const origins = (
    process.env.CLIENT_ORIGIN ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'
  ).split(',').map(origin => origin.trim());

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    const sameOrigin = origin === `${req.protocol}://${req.get('Host')}`;

    if (origin && !sameOrigin && !origins.includes(origin)) {
      return res.status(403).json({
        error: 'Origin is not allowed.'
      });
    }

    if (origin) {
      res.set('Access-Control-Allow-Origin', origin).vary('Origin');
    }

    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };

  const integer = (value, min, max, name) => {
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    ) {
      fail(
        400,
        `${name} must be an integer between ${min} and ${max}.`
      );
    }

    return Number(value);
  };

  const body = req => {
    if (
      req.body === undefined &&
      (
        Number(req.get('Content-Length')) > 0 ||
        req.get('Transfer-Encoding')
      )
    ) {
      fail(415, 'Send the request body as application/json.');
    }

    const value = req.body === undefined ? {} : req.body;

    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object'
    ) {
      fail(400, 'Request body must be an object.');
    }

    return value;
  };

  const run = id => {
    const row = db.get(
      'SELECT * FROM runs WHERE id = ?',
      id
    );

    if (!row) {
      fail(404, 'Run not found.');
    }

    const { configJson, ...fields } = row;

    return {
      ...fields,
      config: JSON.parse(configJson)
    };
  };

  const productView = product => ({
    ...product,
    perishable: product.shelfLifeDays > 0
  });

  app.get('/api', (req, res) => {
    res.json({
      name: 'Autonomous Supermarket API',
      health: '/api/health',
      runs: '/api/runs'
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/config', (req, res) => {
    res.json(getDefaultConfig());
  });

  app.get('/api/products', (req, res) => {
    res.json(getProducts(db).map(productView));
  });

  app.put('/api/products', (req, res) => {
    const input = body(req);

    if (Object.keys(input).some(key => key !== 'products')) {
      fail(400, 'Only products can be changed here.');
    }

    const products = validateProducts(input.products);

    db.transaction(() => {
      db.run('DELETE FROM products');

      for (const product of products) {
        db.insert('products', product);
      }
    });

    res.json(products.map(productView));
  });

  app.get('/api/runs', (req, res) => {
    res.json(
      db.all(`
        SELECT
          id,
          status,
          createdAt,
          completedAt,
          durationMs,
          openingInventoryCents,
          openingCashCents
        FROM runs
        ORDER BY createdAt DESC, rowid DESC
      `)
    );
  });

  app.post('/api/runs', (req, res) => {
    res.status(201).json(runSimulation(db, body(req)));
  });

  app.get('/api/runs/:id', (req, res) => {
    res.json(run(req.params.id));
  });

  app.get('/api/runs/:id/report', (req, res) => {
    run(req.params.id);
    res.json(getReport(db, req.params.id));
  });

  app.get('/api/runs/:id/days', (req, res) => {
    run(req.params.id);

    res.json(
      db.all(
        'SELECT * FROM days WHERE runId = ? ORDER BY day',
        req.params.id
      )
    );
  });

  app.get('/api/runs/:id/days/:day', (req, res) => {
    run(req.params.id);

    res.json(
      getDailyReport(
        db,
        req.params.id,
        integer(req.params.day, 1, 60, 'day')
      )
    );
  });

  app.get('/api/runs/:id/assurance', (req, res) => {
    if (!db.get(
      'SELECT id FROM runs WHERE id = ?',
      req.params.id
    )) {
      fail(404, 'Run not found.');
    }

    res.json(getAssurance(db, req.params.id));
  });

  app.get('/api/submitted-run', (req, res) => {
    const selected = db.get(
      'SELECT value FROM settings WHERE key = ?',
      'submittedRunId'
    );

    res.json(selected ? run(selected.value) : null);
  });

  app.put('/api/submitted-run', (req, res) => {
    const input = body(req);

    if (
      Object.keys(input).some(key => key !== 'runId') ||
      typeof input.runId !== 'string'
    ) {
      fail(400, 'Provide a runId.');
    }

    const selected = run(input.runId);

    if (
      selected.status !== 'completed' ||
      getAssurance(db, selected.id).status !== 'PASS'
    ) {
      fail(
        409,
        'Select a completed run that passes the assurance checks.'
      );
    }

    db.run(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, 'submittedRunId', selected.id);

    res.json(selected);
  });

  const evidence = {
    transactions: [
      'transactions',
      'e.day',
      'EXISTS (SELECT 1 FROM transaction_items i WHERE i.transactionId=e.id AND i.productId=?)'
    ],

    items: [
      'transaction_items',
      '(SELECT day FROM transactions WHERE id=e.transactionId)',
      'e.productId=?'
    ],

    customers: [
      'customers',
      'e.day',
      'EXISTS (SELECT 1 FROM customer_requests r WHERE r.customerId=e.id AND r.productId=?)'
    ],

    requests: [
      'customer_requests',
      'e.day',
      'e.productId=?'
    ],

    inventory: [
      'inventory_events',
      'e.day',
      'e.productId=?'
    ],

    batches: [
      'batches',
      'e.receivedDay',
      'e.productId=?'
    ],

    orders: [
      'orders',
      'e.day',
      'e.productId=?'
    ],

    cash: [
      'cash_events',
      'e.day',
      null
    ],

    alerts: [
      'alerts',
      'e.day',
      'e.productId=?'
    ],

    stock: [
      'daily_stock',
      'e.day',
      'e.productId=?'
    ]
  };

  app.get('/api/runs/:id/evidence/:type', (req, res) => {
    run(req.params.id);

    if (!Object.hasOwn(evidence, req.params.type)) {
      fail(404, 'Unknown evidence type.');
    }

    if (
      Object.keys(req.query).some(
        key => !['day', 'productId', 'limit', 'offset', 'sortBy', 'sortDirection'].includes(key)
      )
    ) {
      fail(400, 'Unknown evidence filter.');
    }

    const [table, dayColumn, productFilter] =
      evidence[req.params.type];

    const sortBy = req.query.sortBy === undefined ? 'id' : req.query.sortBy;
    const sortDirection = req.query.sortDirection === undefined ? 'ascending' : req.query.sortDirection;
    const fields = db.all(`PRAGMA table_info(${table})`).map(field => field.name)
      .filter(field => !['runId', 'detailsJson'].includes(field));
    if (typeof sortBy !== 'string' || !fields.includes(sortBy) ||
        !['ascending', 'descending'].includes(sortDirection)) {
      fail(400, 'Choose a valid evidence column and sort direction.');
    }
    // Sort the entire matching history before loading a window of records.
    const sortColumn = sortBy === 'productId'
      ? '(SELECT p.name FROM run_products p WHERE p.runId=e.runId AND p.productId=e.productId) COLLATE NOCASE'
      : `e.${sortBy} COLLATE NOCASE`;
    const direction = sortDirection === 'descending' ? 'DESC' : 'ASC';

    const filters = ['e.runId=?'];
    const values = [req.params.id];

    if (req.query.day !== undefined) {
      filters.push(`${dayColumn}=?`);

      values.push(
        integer(req.query.day, 1, 60, 'day')
      );
    }

    if (req.query.productId !== undefined) {
      if (!productFilter) {
        fail(
          400,
          'Product filtering is not available for the cash ledger.'
        );
      }

      if (
        typeof req.query.productId !== 'string' ||
        !db.get(
          'SELECT productId FROM run_products WHERE runId=? AND productId=?',
          req.params.id,
          req.query.productId
        )
      ) {
        fail(404, 'Product not found in this run.');
      }

      filters.push(productFilter);
      values.push(req.query.productId);
    }

    const limit = req.query.limit === undefined
      ? 100
      : integer(req.query.limit, 1, 500, 'limit');

    const offset = req.query.offset === undefined
      ? 0
      : integer(req.query.offset, 0, 10000000, 'offset');

    const where = filters.join(' AND ');

    const total = db.get(
      `SELECT COUNT(*) AS count FROM ${table} e WHERE ${where}`,
      ...values
    ).count;

    const rows = db.all(
      `SELECT e.* FROM ${table} e WHERE ${where} ORDER BY ${sortColumn} ${direction}, e.id LIMIT ? OFFSET ?`,
      ...values,
      limit,
      offset
    );

    res.json({
      rows: rows.map(row => {
        if (!row.detailsJson) return row;

        const { detailsJson, ...fields } = row;

        return {
          ...fields,
          details: JSON.parse(detailsJson)
        };
      }),
      total,
      limit,
      offset
    });
  });

  app.get(
    '/api/runs/:id/transactions/:transactionId',
    (req, res) => {
      run(req.params.id);

      const id = integer(
        req.params.transactionId,
        1,
        Number.MAX_SAFE_INTEGER,
        'transactionId'
      );

      const transaction = db.get(
        'SELECT * FROM transactions WHERE runId=? AND id=?',
        req.params.id,
        id
      );

      if (!transaction) {
        fail(404, 'Transaction not found in this run.');
      }

      res.json({
        ...transaction,

        customer: db.get(
          'SELECT * FROM customers WHERE id=?',
          transaction.customerId
        ),

        requests: db.all(
          'SELECT * FROM customer_requests WHERE customerId=?',
          transaction.customerId
        ),

        items: db.all(
          'SELECT * FROM transaction_items WHERE transactionId=?',
          id
        ),

        inventory: db.all(
          'SELECT * FROM inventory_events WHERE transactionId=? ORDER BY id',
          id
        ),

        cash: db.all(
          'SELECT * FROM cash_events WHERE transactionId=? ORDER BY id',
          id
        )
      });
    }
  );

  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      error: 'Endpoint not found.'
    });
  });

  app.use((error, req, res, next) => {
    const status =
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 500;

    if (status === 500) {
      console.error(error);
    }

    res.status(status).json({
      error: status === 500
        ? 'Unexpected server error. Check the server console.'
        : error.message
    });
  });

  return app;
}

if (require.main === module) {
  const db = createDatabase(process.env.DB_PATH);

  if (process.argv.includes('--demo')) {
    try {
      const selected = db.get(
        'SELECT value FROM settings WHERE key=?',
        'submittedRunId'
      );

      const id = selected
        ? selected.value
        : runSimulation(db, { seed: getDefaultConfig().seed }).id;

      const assurance = getAssurance(db, id);

      console.log(
        JSON.stringify(
          {
            submittedRunId: id,
            assurance: assurance.status
          },
          null,
          2
        )
      );

      if (assurance.status !== 'PASS') {
        process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  } else {
    const port = Number(process.env.PORT || 3001);

    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error('PORT must be between 1 and 65535.');
    }

    const server = createApp(db).listen(
      port,
      '127.0.0.1',
      () => {
        console.log(
          `Backend running at http://127.0.0.1:${port}`
        );
      }
    );

    server.on('error', error => {
      console.error(error.message);
      db.close();
      process.exitCode = 1;
    });

    const stop = () => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}

module.exports = { createApp };
