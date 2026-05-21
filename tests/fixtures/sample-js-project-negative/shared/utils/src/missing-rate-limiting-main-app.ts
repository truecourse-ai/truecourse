/**
 * Negative fixture for architecture/deterministic/missing-rate-limiting.
 *
 * A Hono app that defines a public route, exports under a different name
 * (not the router variable), and applies no rate-limit middleware. The rule
 * should still fire — neither the path-mounted-middleware skip nor the
 * sub-router default-export skip apply.
 */

import { Hono } from 'hono';

const app = new Hono();

// VIOLATION: architecture/deterministic/missing-rate-limiting
app.get('/public/feed', (c) => c.json({ items: [] }));

app.post('/public/subscribe', (c) => c.json({ ok: true }));

export const publicSurface = app;
