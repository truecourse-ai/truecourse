/**
 * Positive fixture for architecture/deterministic/missing-rate-limiting.
 *
 * A per-route sub-router file that constructs a router and default-exports
 * it. The mounting site (a different file) is responsible for rate limiting;
 * the sub-router file should not be flagged just because it doesn't
 * re-declare rate limiting itself.
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';

const healthHandler: RequestHandler = (_req, res): void => {
  res.json({ ok: true });
};

const route = Router();

route.get('/health', healthHandler);
route.get('/healthz', healthHandler);

export default route;
