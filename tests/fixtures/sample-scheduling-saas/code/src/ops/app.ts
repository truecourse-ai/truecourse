import express from 'express';
import { errorHandler } from '../shared/errors.js';
import routes from './routes.js';

/** The ops console — the internal staff surface mounted at `/ops`. */
export function buildOpsApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/ops', routes);
  app.use(errorHandler);
  return app;
}
