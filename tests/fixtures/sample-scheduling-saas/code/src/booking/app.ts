import express from 'express';
import { errorHandler } from '../shared/errors.js';
import routes from './routes.js';

/** The booking app — the customer-facing surface mounted at `/api`. */
export function buildBookingApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  app.use(errorHandler);
  return app;
}
