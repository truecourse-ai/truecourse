import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errorHandler } from './middleware/error.js';
import { projectResolver } from './middleware/project.js';
import reposRouter from './routes/repos.js';
import analysesRouter from './routes/analyses.js';
import graphRouter from './routes/graph.js';
import filesRouter from './routes/files.js';
import violationsRouter from './routes/violations.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import flowsRouter from './routes/flows.js';
import analyticsRouter from './routes/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  serveStatic?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): express.Express {
  const app: express.Express = express();

  app.use(cors());
  app.use(express.json());

  // Home page / registry routes run without a project.
  app.use('/api/repos', reposRouter);
  // Project-scoped routes. Each router's patterns declare their own `:id`
  // (e.g. `/:id/violations`), so we mount at `/api/repos` — the router
  // matches the `:id` segment itself. The resolver validates the slug and
  // touches `lastAccessed`.
  app.use('/api/repos', projectResolver, analysesRouter);
  app.use('/api/repos', projectResolver, graphRouter);
  app.use('/api/repos', projectResolver, filesRouter);
  app.use('/api/repos', projectResolver, violationsRouter);
  app.use('/api/repos', projectResolver, databasesRouter);
  app.use('/api/repos', projectResolver, flowsRouter);
  app.use('/api/repos', projectResolver, analyticsRouter);
  app.use('/api/rules', rulesRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);

  if (opts.serveStatic !== false) {
    const staticDir = path.join(__dirname, 'public');
    if (fs.existsSync(staticDir)) {
      app.use(express.static(staticDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(staticDir, 'index.html'));
      });
    }
  }

  return app;
}
