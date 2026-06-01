import express from 'express';
import routes from './routes.js';
import { rateLimit } from './middleware/rate-limit.middleware.js';

// An ADR calls for Vite as the build system, but this service ships no
// build config of any kind (no vite/webpack/etc.), so the build system
// can't be determined from the code.
// IL-DRIFT: ArchitectureDecision:build-system.vite / architecture.build-system.inconclusive

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(rateLimit());
  app.use(routes);
  return app;
}
