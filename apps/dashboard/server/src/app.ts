import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errorHandler } from './middleware/error.js';
import { createProjectResolver } from './middleware/project.js';
import { createReposRouter } from './routes/repos.js';
import specRouter from './routes/spec.js';
import { createContextRouter, createContextBindingsRouter } from './routes/context.js';
import { createHomeRouter } from './routes/home.js';
import guardRouter from './routes/guard.js';
import guardActionsRouter from './routes/guard-actions.js';
import sessionsRouter, { createWorkspaceSessionsRouter } from './routes/sessions.js';
import capabilitiesRouter from './routes/capabilities.js';
import llmRouter from './routes/llm.js';
import { createUsageRouter } from './routes/usage.js';
import { createCreditsRouter, createOperatorCreditsRouter } from './routes/credits.js';
import { isLocalMode } from './mode.js';
import { createAuthGate } from './middleware/auth.js';
import { actorContext } from './middleware/actor.js';
import type { GithubMount } from './github/index.js';
import type { RepoLinkStore } from './routes/repos.js';
import type { JobsMount } from './jobs/index.js';
import type { ServerRouterMount } from './features.js';
import { setCurrentJobs } from './jobs/current.js';
import type { AuthVerifier } from '@truecourse/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** What a server with no job runner tells a caller who reaches its job routes. */
const JOBS_NOT_RUNNING =
  'Background jobs are not running on this server.';

/** What an unconfigured server tells a caller who reaches /api/github. */
const GITHUB_NOT_CONFIGURED =
  'GitHub is not configured on this server. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ' +
  'GITHUB_APP_WEBHOOK_SECRET and GITHUB_APP_SLUG, then restart it.';

/** What a request under /api that no router answered is told. */
const API_ROUTE_NOT_FOUND = 'The server has no such route.';

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
   * The workspace's people, mounted at /api/workspace BEHIND the gate: every
   * route there reads the session's organization off the request.
   */
  workspaceRouter?: express.Router;
  /**
   * The connected repositories, whichever provider brought them — what scopes
   * every repository route to the caller's workspace. REQUIRED for the same
   * reason as `authVerifier`: a server that resolved repositories from nowhere
   * would show every workspace's. `null` (tests pass their own double) means
   * no repository is visible to anyone.
   */
  repoLinks: RepoLinkStore | null;
  /**
   * Folders on this machine, as repositories. Present only in local mode;
   * mounts behind the gate beside the other workspace-scoped routers.
   */
  localRouter?: express.Router | null;
  /**
   * The GitHub App connection. REQUIRED for the same reason as `authVerifier`:
   * whether this server can connect repositories is a deployment decision, not
   * a default. `null` means the App isn't configured — /api/github then answers
   * 503 instead of 404, so the client can say why.
   */
  github: GithubMount | null;
  /**
   * The background job runner. REQUIRED for the same reason as `github`: a
   * server that answers /api/jobs without one would be lying. `null` (tests
   * pass it) makes the three job routes answer 503.
   */
  jobs: JobsMount | null;
  /**
   * Routers this edition adds, already built (see `features.ts`). The open
   * edition has none; boot builds the enterprise bundle's when the loader
   * registered it.
   */
  featureRouters?: ServerRouterMount[];
}

export function createApp(opts: CreateAppOptions): express.Express {
  const app: express.Express = express();

  // The routes that START work enqueue onto the runner rather than doing it
  // inline, so the mount this app was built with is what they reach for.
  setCurrentJobs(opts.jobs);

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

  const featureRouters = opts.featureRouters ?? [];
  for (const mount of featureRouters) {
    if (mount.public) app.use(mount.path, mount.router);
  }

  // Capabilities + health stay public so the client can discover the
  // feature gates and liveness before authenticating.
  app.use('/api/capabilities', capabilitiesRouter);
  // Liveness only: no database or worker probe. `release` is the deployed
  // image digest a VM release sets, so a deploy can tell the new process from
  // the one it replaced.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      release: process.env.TRUECOURSE_RELEASE ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  // GitHub posts webhooks with no session — the HMAC signature over the raw
  // body is its authentication — so the receiver mounts above the gate. When
  // the App isn't configured the whole /api/github surface (webhook included)
  // answers 503 with the env vars to set, rather than a 404 that reads as a bug.
  if (opts.github) {
    app.use('/api/github', opts.github.webhook);
    // GET /setup is a browser TOP-LEVEL NAVIGATION from GitHub after an App
    // install. Behind the gate, a missing/expired session would render raw
    // 401 JSON as the whole page and the installation would never bind to a
    // workspace (invisible to /status, 403 on connect — a dead end). Bounce
    // through login instead, returning here with a live session; with one,
    // fall through to the gate and the connect router's real handler.
    if (opts.authVerifier) {
      const verify = opts.authVerifier;
      app.get('/api/github/setup', async (req, res, next) => {
        const session = await verify(req.headers.cookie).catch(() => null);
        if (session) {
          next();
          return;
        }
        res.redirect(`/api/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
      });
    }
  } else {
    app.use('/api/github', (_req, res) => {
      res.status(503).json({ error: GITHUB_NOT_CONFIGURED });
    });
  }

  // The auth gate protects everything under /api below this line. Static SPA
  // assets are outside /api, so the dashboard shell still loads to drive login.
  app.use('/api', createAuthGate(opts.authVerifier));
  // Carry the caller's identity down the whole call stack, so a seam a route
  // reaches through (the repository link store) knows a person was behind its
  // write. Above the gate there is no session and no actor, which is what tells
  // a webhook's write apart from a route's.
  app.use('/api', actorContext());

  // The connect API is workspace-scoped, so it sits behind the gate.
  if (opts.github) {
    app.use('/api/github', opts.github.connect);
  }

  // Which workspace owns a connected repository — the one thing every
  // slug-resolving route needs, so another workspace's repo reads as absent.
  const repoLinks = opts.repoLinks;

  // The workspace's people: its WorkOS organization's memberships and the
  // invitations standing against it. Scoped to the session's organization, so
  // it needs the gate above it and nothing else.
  if (opts.workspaceRouter) app.use('/api/workspace', opts.workspaceRouter);

  // Folders on this machine, as repositories (local mode only).
  if (opts.localRouter) app.use('/api/local', opts.localRouter);

  // This edition's own routers, with the session already resolved.
  for (const mount of featureRouters) {
    if (!mount.public) app.use(mount.path, mount.router);
  }

  // The workspace's Models settings — workspace-scoped, not repo-scoped, so it
  // sits beside the registry routes rather than behind the project resolver.
  app.use('/api/llm', llmRouter);

  // What this workspace's runs spent at the model. Workspace-scoped and
  // read-only, so it sits beside the Models settings it accounts for.
  app.use('/api/usage', createUsageRouter({ repoLinks }));

  // What it may spend of TrueCourse's own. Absent in local mode, where there is
  // no operator to grant anything and no platform key to spend: the `/api`
  // catch-all below answers those addresses as the routes they are not.
  if (!isLocalMode()) {
    app.use('/api/credits', createCreditsRouter());
    app.use('/api/operator/credits', createOperatorCreditsRouter());
  }

  // The job queue: the live event stream, job status, and the notifications
  // feed. Workspace-scoped like the Models settings, so they mount together.
  if (opts.jobs) {
    app.use('/api/events', opts.jobs.routers.events);
    app.use('/api/jobs', opts.jobs.routers.jobs);
    app.use('/api/notifications', opts.jobs.routers.notifications);
  } else {
    for (const route of ['/api/events', '/api/jobs', '/api/notifications']) {
      app.use(route, (_req, res) => {
        res.status(503).json({ error: JOBS_NOT_RUNNING });
      });
    }
  }

  // The workspace's CONTEXT: its documentation sources and what they yielded.
  // A source belongs to the workspace, not to a repository, so this mounts
  // above the repository routers and behind the gate alone — no slug to resolve.
  app.use('/api/context', createContextRouter({ repoLinks, github: opts.github?.access ?? null }));

  // Home: the workspace's sections today and over time, what waits on a person
  // and what changed. Workspace-scoped like Context, and read-only.
  app.use('/api/home', createHomeRouter({ repoLinks }));

  // Home page / registry routes run without a project.
  app.use('/api/repos', createReposRouter({ repoLinks }));
  // The workspace's agent runs across every repository it connected, scoped by
  // the same link store, so it needs no project resolver.
  app.use('/api/sessions', createWorkspaceSessionsRouter({ repoLinks }));
  // Project-scoped routes. Each router's patterns declare their own `:id`
  // (e.g. `/:id/guard`), so we mount at `/api/repos` — the router
  // matches the `:id` segment itself. The resolver validates the slug and
  // scopes it to the caller's workspace.
  const projectResolver = createProjectResolver(repoLinks);
  app.use('/api/repos', projectResolver, specRouter);
  app.use('/api/repos', projectResolver, createContextBindingsRouter());
  app.use('/api/repos', projectResolver, guardRouter);
  app.use('/api/repos', projectResolver, guardActionsRouter);
  app.use('/api/repos', projectResolver, sessionsRouter);

  // Nothing under /api answered: say so as JSON. Without this a GET here falls
  // through to the SPA's index.html with a 200 and a POST to Express's HTML
  // page, and the client shows a parse error instead of the refusal.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: API_ROUTE_NOT_FOUND });
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
