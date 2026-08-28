import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errorHandler } from './middleware/error.js';
import { createProjectResolver } from './middleware/project.js';
import { createReposRouter } from './routes/repos.js';
import analysesRouter from './routes/analyses.js';
import graphRouter from './routes/graph.js';
import filesRouter from './routes/files.js';
import violationsRouter from './routes/violations.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import flowsRouter from './routes/flows.js';
import analyticsRouter from './routes/analytics.js';
import specRouter from './routes/spec.js';
import specSourcesRouter from './routes/spec-sources.js';
import guardRouter from './routes/guard.js';
import guardActionsRouter from './routes/guard-actions.js';
import sessionsRouter from './routes/sessions.js';
import capabilitiesRouter from './routes/capabilities.js';
import { createAuthGate } from './middleware/auth.js';
import type { GithubMount } from './github/index.js';
import type { AuthVerifier } from '@truecourse/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** What an unconfigured server tells a caller who reaches /api/github. */
const GITHUB_NOT_CONFIGURED =
  'GitHub is not configured on this server. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ' +
  'GITHUB_APP_WEBHOOK_SECRET and GITHUB_APP_SLUG, then restart it.';

export interface CreateAppOptions {
  serveStatic?: boolean;
  /**
   * The session verifier the gate enforces with. REQUIRED — omitting it would
   * mean an app that boots wide open, so that must not compile. Pass `null`
   * deliberately (tests do) to make the gate a pass-through.
   */
  authVerifier: AuthVerifier | null;
  /** Public auth routes, mounted at /api/auth above the gate. */
  authRouter?: express.Router;
  /**
   * The GitHub App connection. REQUIRED for the same reason as `authVerifier`:
   * whether this server can connect repositories is a deployment decision, not
   * a default. `null` means the App isn't configured — /api/github then answers
   * 503 instead of 404, so the client can say why.
   */
  github: GithubMount | null;
}

export function createApp(opts: CreateAppOptions): express.Express {
  const app: express.Express = express();

  // Reflect the request origin and allow credentials so the session cookie
  // flows on cross-origin dev requests (client :3000 → server :3001).
  // Same-origin in production, where this is a no-op.
  app.use(cors({ origin: true, credentials: true }));
  // Capture the raw body alongside JSON parsing so a webhook receiver can
  // verify an HMAC signature over the exact bytes.
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

  // Auth endpoints (login / callback / logout / me) must be reachable
  // without a session, so they mount before the gate.
  if (opts.authRouter) app.use('/api/auth', opts.authRouter);

  // Capabilities + health stay public so the client can discover the
  // feature gates and liveness before authenticating.
  app.use('/api/capabilities', capabilitiesRouter);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // GitHub posts webhooks with no session — the HMAC signature over the raw
  // body is its authentication — so the receiver mounts above the gate. When
  // the App isn't configured the whole /api/github surface (webhook included)
  // answers 503 with the env vars to set, rather than a 404 that reads as a bug.
  if (opts.github) {
    app.use('/api/github', opts.github.webhook);
  } else {
    app.use('/api/github', (_req, res) => {
      res.status(503).json({ error: GITHUB_NOT_CONFIGURED });
    });
  }

  // The auth gate protects everything under /api below this line. Static SPA
  // assets are outside /api, so the dashboard shell still loads to drive login.
  app.use('/api', createAuthGate(opts.authVerifier));

  // The connect API is workspace-scoped, so it sits behind the gate.
  if (opts.github) {
    app.use('/api/github', opts.github.connect);
  }

  // Which workspace owns a connected repository — the one thing every
  // slug-resolving route needs, so another workspace's repo reads as absent.
  const githubLinks = opts.github?.store ?? null;

  // Home page / registry routes run without a project.
  app.use('/api/repos', createReposRouter({ githubLinks }));
  // Project-scoped routes. Each router's patterns declare their own `:id`
  // (e.g. `/:id/violations`), so we mount at `/api/repos` — the router
  // matches the `:id` segment itself. The resolver validates the slug, scopes
  // it to the caller's workspace, and touches `lastAccessed`.
  const projectResolver = createProjectResolver(githubLinks);
  app.use('/api/repos', projectResolver, analysesRouter);
  app.use('/api/repos', projectResolver, graphRouter);
  app.use('/api/repos', projectResolver, filesRouter);
  app.use('/api/repos', projectResolver, violationsRouter);
  app.use('/api/repos', projectResolver, databasesRouter);
  app.use('/api/repos', projectResolver, flowsRouter);
  app.use('/api/repos', projectResolver, analyticsRouter);
  app.use('/api/repos', projectResolver, specRouter);
  app.use('/api/repos', projectResolver, specSourcesRouter);
  app.use('/api/repos', projectResolver, guardRouter);
  app.use('/api/repos', projectResolver, guardActionsRouter);
  app.use('/api/repos', projectResolver, sessionsRouter);
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
