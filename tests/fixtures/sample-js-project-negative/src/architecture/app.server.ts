/**
 * Architecture violation for request body size limit.
 * File path must contain 'app.' or 'server.' for the visitor to check it.
 */
import express from 'express';

const app = express();

// VIOLATION: architecture/deterministic/missing-request-body-size-limit
// express.json() used without a 'limit' option — large payloads may cause OOM
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export { app };
