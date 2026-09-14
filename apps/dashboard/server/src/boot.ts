/**
 * Boot: everything the server is, assembled in order and started.
 *
 * Exported rather than run on import, so the enterprise bundle can register its
 * features (see `features.ts`) and then start the same server. `index.ts` is
 * the open edition's process entry and does nothing but call this.
 */

import { createServer } from 'http';
import path from 'node:path';
import '@truecourse/core/config/env';
import { setupSocket } from './socket/index.js';
import { createApp } from './app.js';
import { createAuth } from './auth/index.js';
import { serverMode } from './mode.js';
import { createLocalConnection, type LocalMount } from './local/index.js';
import { registeredServerFeatures, type ServerRouterMount } from './features.js';
import { createGithubConnection } from './github/index.js';
import { createServerJobs } from './jobs/index.js';
import { closeDb, getDb, getDbHandle, initDb } from './db.js';
import {
  installDbStores,
  reconcileStoredRuns,
  setRepoWorkspaceLookup,
  subscribeSessionRunWrites,
  workspaceOfRepo,
} from './stores.js';
import { PgRepositoryStore } from '@truecourse/data-store';
import { setRepoProviderLookup } from './services/work-tree.service.js';
import { startRunChangeRelay } from './services/run-events.service.js';
import { setContextEventPublisher } from './services/context.service.js';
import { startContextSyncSchedule, type ContextSchedule } from './services/context-schedule.service.js';
import { operatorClaudeCode } from './services/workspace-llm.service.js';
import { sweepRunClones } from './services/run-clone.service.js';
import { setRepoJobsCanceller } from './services/repo-removal.service.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { stopAllRunsWatches } from './services/run-watch.service.js';
import { getLogDir } from '@truecourse/core/config/runtime-dir';
import { initSentry, flushSentry } from './observability/sentry.js';
import { ServerLogTransport } from './observability/log-transport.js';
import { getProjectByPath, slugify } from '@truecourse/core/config/registry';
import { LOCAL_ORG_ID } from './auth/local.js';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { closeLogger, FileLogTransport, setLogTransport, log } from '@truecourse/core/lib/logger';
import { publishEvent } from '@truecourse/jobs';

const port = parseInt(process.env.PORT || '3001', 10);

export async function startServer(): Promise<void> {
  // How this server runs — hosted behind WorkOS, or local on one machine.
  // Read first: everything below is assembled differently for each, and an
  // unusable value must stop the boot before anything is opened.
  const mode = serverMode();
  // 1. Route all internal diagnostics to the server log file, through the
  //    transport that also reports errors to Sentry. Under `pnpm dev`
  //    `TRUECOURSE_DEV=1` tees lines to stderr so the dev terminal shows them;
  //    a deployment that collects logs from a fixed path sets
  //    `TRUECOURSE_LOG_DIR`.
  initSentry();
  setLogTransport(
    new ServerLogTransport(
      new FileLogTransport({
        filePath: path.join(process.env.TRUECOURSE_LOG_DIR ?? getLogDir(), 'dashboard.log'),
        tee: process.env.TRUECOURSE_DEV === '1',
      }),
    ),
  );

  // 2. Postgres. All server state lives there — there is no file fallback, so
  //    DATABASE_URL is required and createDb applies the migrations at boot.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required: the dashboard server stores its state in Postgres. ' +
        'Set DATABASE_URL to a Postgres connection string (e.g. postgres://user:pass@localhost:5432/truecourse).',
    );
  }
  // TRUECOURSE_SECRET_KEY derives the AES key the workspace's LLM provider key
  // is encrypted with, so — like DATABASE_URL — it is REQUIRED. A missing or
  // weak secret fails boot rather than running half-secure.
  const masterSecret = process.env.TRUECOURSE_SECRET_KEY;
  if (!masterSecret || masterSecret.length < 32) {
    throw new Error(
      'TRUECOURSE_SECRET_KEY (32+ characters) is required: the dashboard server stores each ' +
        "workspace's LLM provider key encrypted in Postgres. Set TRUECOURSE_SECRET_KEY to a strong secret.",
    );
  }

  await initDb(databaseUrl);
  log.info('[Server] db ready (Postgres, migrations applied)');
  // Fill every storage seam before anything reads or writes repo state, and
  // clear run-clone debris a crashed process left behind.
  installDbStores(getDbHandle(), { masterSecret });
  // What a dead process left behind: its runs settle `interrupted` (the jobs
  // queue settles its abandoned rows the same way when it starts), and its
  // half-written clones go.
  await reconcileStoredRuns();
  sweepRunClones();
  if (operatorClaudeCode()) {
    log.info("[LLM] operator mode — every workspace runs on this process's Claude Code login");
  }

  // 3. Session auth. Hosted: WorkOS, throwing if the WORKOS_* env is
  //    incomplete — the server boots authenticated or not at all. Local: the
  //    one implicit session, with no identity provider at all.
  const auth = createAuth(mode);
  log.info(`[Server] ${mode} mode`);

  // The connected repositories, whichever provider brought them. Built before
  // the providers: each writes its rows through this one store, and a run
  // resolves which provider has a repository's files from it.
  const repoLinks = new PgRepositoryStore(getDb());
  setRepoProviderLookup(async (repoKey) => (await repoLinks.getRepo(repoKey))?.provider ?? null);
  // A `context/` document ref belongs to a workspace, not to a repository, so
  // the doc reader needs to know whose workspace a repository reads.
  setRepoWorkspaceLookup(async (repoKey) => (await repoLinks.getRepo(repoKey))?.workspaceOrgId ?? null);

  // 4. Background job queue. Long-running work runs here instead of inside the
  //    request that asked for it. Built BEFORE the GitHub connection, whose
  //    link hook enqueues the onboarding scan, and started after — the task
  //    bodies read seams (the work-tree provider) the connection installs.
  const jobs = createServerJobs({ db: getDb(), connectionString: databaseUrl });
  // Disconnecting a repository stops whatever it has in flight.
  setRepoJobsCanceller(jobs.cancelRepoJobs);
  // A Context mutation is workspace-wide, so it rides the SSE stream the
  // workspace already holds open rather than a repository's socket room.
  setContextEventPublisher((org, event) => publishEvent(getDb(), org, event));
  // A run's record writes ride the same stream: the Agent page and the open
  // conversation follow work the moment the store commits it, including a run
  // of the workspace itself, which belongs to no repository room.
  const stopRunRelay = startRunChangeRelay({
    subscribe: subscribeSessionRunWrites,
    workspaceOf: workspaceOfRepo,
    publish: (org, event) => publishEvent(getDb(), org, event),
  });

  // 5. GitHub App connection. Optional: without GITHUB_APP_* the server still
  //    boots, and /api/github answers 503 with the vars to set.
  const github = createGithubConnection({
    repos: repoLinks,
    // A push to a source's repository syncs the source.
    contextSync: async (orgId, sourceId, source) => {
      const outcome = await jobs.enqueueContextSync({ workspaceOrgId: orgId, sourceId, source });
      return outcome.status;
    },
    // Connecting a repository starts its Flow setup. Its context is Context's.
    startSetup: async (link) => {
      const entry = await getProjectByPath(link.repoFullName);
      const outcome = await jobs.enqueueGuardSetup({
        repoId: entry?.slug ?? slugify(link.repoFullName, []),
        repoFullName: link.repoFullName,
        workspaceOrgId: link.workspaceOrgId,
        source: 'chain',
      });
      return outcome.status;
    },
  });
  if (github) {
    log.info('[Server] GitHub connect enabled');
  } else {
    log.info('[Server] GitHub connect disabled — set GITHUB_APP_* to enable');
  }

  // A decision that clears the last block on a generate (the final conflict
  // resolved, the last active finding dismissed) re-generates on its own. The
  // seam is keyed by repo identity alone, so the workspace and the slug are
  // looked up from the link and the registry; a repo nobody connected is
  // silently left alone — the seam is best-effort by contract.
  setGuardGenerateEnqueue(async (repoKey) => {
    const [link, entry] = await Promise.all([repoLinks.getRepo(repoKey), getProjectByPath(repoKey)]);
    if (!link?.workspaceOrgId || !entry) return;
    await jobs.enqueueGuardGenerate({
      repoId: entry.slug,
      repoFullName: repoKey,
      workspaceOrgId: link.workspaceOrgId,
      source: 'chain',
    });
  });

  // 5b. Folders on this machine, as repositories. Local mode only: the server
  //     and the developer share a filesystem there and nowhere else.
  let local: LocalMount | null = null;
  if (mode === 'local') {
    local = createLocalConnection({
      repos: repoLinks,
      contextSync: async (orgId, sourceId, source) => {
        const outcome = await jobs.enqueueContextSync({ workspaceOrgId: orgId, sourceId, source });
        return outcome.status;
      },
      startSetup: async (link) => {
        const entry = await getProjectByPath(link.repoFullName);
        const outcome = await jobs.enqueueGuardSetup({
          repoId: entry?.slug ?? slugify(link.repoFullName, []),
          repoFullName: link.repoFullName,
          workspaceOrgId: link.workspaceOrgId,
          source: 'chain',
        });
        return outcome.status;
      },
    });
    // Whatever this machine already connected is watched again from here: a
    // folder has no webhook, so a change on disk is the only notice there is.
    await local.watchConnected(LOCAL_ORG_ID);
    log.info('[Server] local folders can be connected as repositories');
  }

  // A site has no push to refresh it, so it is swept on a clock: every site
  // older than a day gets a sync enqueued (single-flight collapses duplicates).
  const contextSchedule: ContextSchedule = startContextSyncSchedule(getDb(), {
    enqueue: (request) => jobs.enqueueContextSync(request),
  });

  // A failure to start must not stop the server coming up — the routes then
  // answer honestly that jobs aren't running.
  try {
    await jobs.start();
    log.info('[Server] background jobs running');
    // One sweep now the queue can take it: a source that has never synced,
    // because its first sync died with the process, gets one here rather than
    // waiting out the hour.
    void contextSchedule.sweep().catch((err: unknown) => {
      log.warn(`[context] the sweep failed: ${(err as Error).message}`);
    });
  } catch (err) {
    log.error(
      `[Server] background jobs failed to start (jobs will not process): ${(err as Error).message}`,
    );
  }

  // 6. This edition's own routers, built once from what boot already has. The
  //    open edition has none — nobody registered any.
  const featureRouters: ServerRouterMount[] = [];
  for (const feature of registeredServerFeatures()) {
    featureRouters.push(
      ...feature.mount({ db: getDb(), masterSecret, workspaceSession: auth.workspaceSession }),
    );
    log.info(`[Server] ${feature.name} enabled`);
  }

  // 7. Setup Express app + socket.io
  const app = createApp({
    authVerifier: auth.verify,
    authRouter: auth.router,
    workspaceRouter: auth.members,
    repoLinks,
    github,
    localRouter: local?.router ?? null,
    jobs,
    featureRouters,
  });
  const httpServer = createServer(app);
  setupSocket(httpServer);

  // 8. Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use. Is another TrueCourse instance running?\n` +
          `Stop it first, or set PORT to use a different port.`
        ));
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, () => {
      log.banner([
        '',
        '         _|_',
        '        /_|_\\',
        '          |',
        '         /|',
        '        / |',
        '       /  |',
        '      /   |',
        '     /    |',
        '    /_____|_____\\',
        '    \\__________|',
        '     \\_________/',
        '   ~~~~~~~~~~~~~~',
        '',
        '   Charting your course...',
        '',
      ]);
      log.info(`[Server] Listening on port ${port}`);
      resolve();
    });
  });

  // Graceful shutdown
  async function shutdown() {
    log.info('[Server] Shutting down...');
    local?.stop();
    stopAllWatchers();
    stopAllRunsWatches();
    stopRunRelay();
    contextSchedule.stop();
    httpServer.closeAllConnections();
    httpServer.close();
    // Stop the queue before the pool it runs on.
    await jobs.stop();
    await closeDb();
    log.info('[Server] Closed');
    await closeLogger();
    await flushSentry();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Start the server as a process: boot, and on a fatal failure say why and exit.
 * The logger may not be configured yet, so the reason goes to stderr, where an
 * operator always sees it.
 */
export function runServer(): void {
  startServer().catch(async (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    await flushSentry();
    process.exit(1);
  });
}
