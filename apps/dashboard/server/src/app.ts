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
import specRouter from './routes/spec.js';
import contractsRouter from './routes/contracts.js';
import verifyRouter from './routes/verify.js';
import capabilitiesRouter from './routes/capabilities.js';
import { enterpriseAuthGate } from './middleware/ee-auth.js';
import { getPublicRouters, getProtectedRouters } from './ee-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  serveStatic?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): express.Express {
  const app: express.Express = express();

  // Reflect the request origin and allow credentials so the enterprise
  // session cookie flows on cross-origin dev requests (client :3000 →
  // server :3001). Same-origin in production, where this is a no-op.
  app.use(cors({ origin: true, credentials: true }));
  // Capture the raw body alongside JSON parsing so webhook receivers (e.g. the
  // enterprise GitHub App) can verify HMAC signatures over the exact bytes.
  app.use(
    express.json({
      // GitHub webhook payloads (e.g. large pull_request events) can exceed the
      // 100kb default; raise the cap so signed deliveries still verify.
      limit: '5mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // --- Enterprise (no-ops in community) -----------------------------
  // Public enterprise endpoints (login / callback / logout / me) must
  // be reachable without a session, so they mount before the gate.
  for (const r of getPublicRouters()) app.use(r.basePath, r.router);

  // Capabilities + health stay public so the client can discover the
  // edition and liveness before authenticating.
  app.use('/api/capabilities', capabilitiesRouter);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // The enterprise auth gate protects everything under /api below this
  // line (transparent pass-through in community). Static SPA assets are
  // outside /api, so the dashboard shell still loads to drive login.
  app.use('/api', enterpriseAuthGate);

  // Protected enterprise routers (e.g. Workspace data) sit behind the gate.
  for (const r of getProtectedRouters()) app.use(r.basePath, r.router);

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
  app.use('/api/repos', projectResolver, specRouter);
  app.use('/api/repos', projectResolver, contractsRouter);
  app.use('/api/repos', projectResolver, verifyRouter);
  app.use('/api/rules', rulesRouter);

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
