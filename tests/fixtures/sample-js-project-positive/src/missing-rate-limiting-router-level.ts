/**
 * Positive fixture for architecture/deterministic/missing-rate-limiting.
 *
 * Main router with rate limiting wired via path-mounted middleware variables:
 *     app.use('/api/v1/*', apiV1RateLimitMiddleware);
 * The middleware identifiers carry a rate-limit substring but the visitor
 * only recognised CALLS to functions whose name *starts* with
 * `rateLimit…`/`throttle…` — passing such an identifier as an argument to
 * `.use(...)` was not recognised.
 */

import express from 'express';
import helmet from 'helmet';
import type { RequestHandler } from 'express';

declare const apiV1RateLimitMiddleware: RequestHandler;
declare const apiV2RateLimitMiddleware: RequestHandler;
declare const fileUploadRateLimitMiddleware: RequestHandler;

const healthHandler: RequestHandler = (_req, res): void => {
  res.json({ ok: true });
};

const app = express();

app.use(helmet());

app.use('/api/v1/*', apiV1RateLimitMiddleware);
app.use('/api/v2/*', apiV2RateLimitMiddleware);
app.use('/api/files/upload', fileUploadRateLimitMiddleware);

app.get('/health', healthHandler);
app.get('/healthz', healthHandler);

export { app };
