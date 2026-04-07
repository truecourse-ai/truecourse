/**
 * Architecture violations detected in route/handler files.
 * The file path must match /route|controller|handler|api|server/i for these visitors.
 */
import express from 'express';

const app = express();

app.use(express.json());

// VIOLATION: architecture/deterministic/missing-rate-limiting
// Route file with routes but no request-frequency limiting.

// VIOLATION: architecture/deterministic/route-without-auth-middleware
// Route with only path + handler (2 args), no auth middleware, non-public path
app.get('/api/orders', (req, res) => {
  res.json({ orders: [] });
});

// VIOLATION: architecture/deterministic/missing-input-validation
// POST handler that accesses req.body without any validation (.parse, .validate, etc.)
app.post('/api/items', (req, res) => {
  const { name, price } = req.body;
  res.status(201).json({ name, price });
});

// VIOLATION: architecture/deterministic/missing-pagination-endpoint
// GET handler that returns a list (findAll) without pagination (no limit, offset, page, cursor)
app.get('/api/products', async (req, res) => {
  const products = await db.findAll();
  res.json(products);
});

// VIOLATION: architecture/deterministic/missing-error-status-code
// Catch block sends response without setting error status code
app.get('/api/data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    res.json({ error: 'Failed to fetch data' });
  }
});

// VIOLATION: architecture/deterministic/raw-error-in-response
// Catch block sends error.message or error.stack to client
app.get('/api/details', async (req, res) => {
  try {
    const details = await loadDetails();
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Helper stubs to make the code parseable
declare function fetchData(): Promise<any>;
declare function loadDetails(): Promise<any>;
declare const db: { findAll(): Promise<any[]> };
