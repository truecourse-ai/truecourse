/**
 * A data-fetching endpoint declared directly on the express app without any
 * auth middleware in its chain and without a global auth registration in
 * this file. The handler reads from a privileged store and should be gated.
 */

import express from 'express';

const app = express();

declare function loadInvoices(userId: string): Promise<Array<{ id: string }>>;

// VIOLATION: architecture/deterministic/route-without-auth-middleware
app.get('/api/invoices', async (req, res) => {
  const invoices = await loadInvoices(String(req.query.userId));
  res.json(invoices);
});

export { app };
