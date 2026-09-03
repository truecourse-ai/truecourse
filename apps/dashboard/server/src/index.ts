import { createServer } from 'http';
import path from 'node:path';
import '@truecourse/core/config/env';
import { setupSocket } from './socket/index.js';
import { createApp } from './app.js';
import { createAuth } from './auth/index.js';
import { createGithubConnection } from './github/index.js';
import { createServerJobs } from './jobs/index.js';
import { closeDb, getDb, getDbHandle, initDb } from './db.js';
import { installDbStores } from './stores.js';
import { operatorClaudeCode } from './services/workspace-llm.service.js';
import { sweepStaleRunClones } from './services/run-clone.service.js';
import { setRepoJobsCanceller } from './services/repo-removal.service.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { stopAllRunTails } from './services/session-tailer.service.js';
import { wipeLegacyPostgresData, getLogDir } from '@truecourse/core/config/paths';
import { getProjectByPath } from '@truecourse/core/config/registry';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { closeLogger, configureLogger, log } from '@truecourse/core/lib/logger';

const port = parseInt(process.env.PORT || '3001', 10);

async function main() {
  // 0. Route all internal diagnostics to the dashboard log file. When running
  //    via `pnpm dev` the `TRUECOURSE_DEV=1` env var tees lines to stderr
  //    too so the dev terminal still shows them. Packaged dashboard (console
  //    or service) gets file-only output. Service installers pass an explicit
  //    `TRUECOURSE_LOG_DIR` so the log lands somewhere the user can reach
  //    even when the service runs as a system account whose `os.homedir()`
  //    differs from the invoking user's.
  const logDir = process.env.TRUECOURSE_LOG_DIR ?? getLogDir();
  configureLogger({
    filePath: path.join(logDir, 'dashboard.log'),
    tee: process.env.TRUECOURSE_DEV === '1',
  });

  // 1. One-time cleanup of the pre-0.4 embedded-postgres data dir
  if (wipeLegacyPostgresData()) {
    log.info('[Storage] Legacy Postgres data wiped. Re-analyze to repopulate.');
  }

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
  // Swap the file storage seams for Postgres before anything reads or writes
  // repo state, and clear run-clone debris a crashed process left behind.
  installDbStores(getDbHandle(), { masterSecret });
  sweepStaleRunClones();
  if (operatorClaudeCode()) {
    log.info("[LLM] operator mode — every workspace runs on this process's Claude Code login");
  }

  // 3. WorkOS session auth. Throws if the WORKOS_* env is incomplete — the
  //    server boots authenticated or not at all.
  const auth = createAuth();

  // 4. Background job queue. Long-running work runs here instead of inside the
  //    request that asked for it. Built BEFORE the GitHub connection, whose
  //    link hook enqueues the onboarding scan, and started after — the task
  //    bodies read seams (the work-tree provider) the connection installs.
  const jobs = createServerJobs({ db: getDb(), connectionString: databaseUrl });
  // Disconnecting a repository stops whatever it has in flight.
  setRepoJobsCanceller(jobs.cancelRepoJobs);

  // 5. GitHub App connection. Optional: without GITHUB_APP_* the server still
  //    boots, and /api/github answers 503 with the vars to set.
  const github = createGithubConnection({
    scan: async (repoId, repoKey, orgId) => {
      const outcome = await jobs.enqueueScan({
        repoId,
        repoFullName: repoKey,
        workspaceOrgId: orgId,
        source: 'connect',
      });
      return outcome.status;
    },
  });
  if (github) {
    log.info('[Server] GitHub connect enabled');
    // A decision that clears the last block on a generate (the final conflict
    // resolved, the last active finding dismissed) re-generates on its own. The
    // seam is keyed by repo identity alone, so the workspace and the slug are
    // looked up from the link and the registry; a repo nobody connected is
    // silently left alone — the seam is best-effort by contract.
    setGuardGenerateEnqueue(async (repoKey) => {
      const [link, entry] = await Promise.all([github.store.getRepo(repoKey), getProjectByPath(repoKey)]);
      if (!link?.workspaceOrgId || !entry) return;
      await jobs.enqueueGuardGenerate({
        repoId: entry.slug,
        repoFullName: repoKey,
        workspaceOrgId: link.workspaceOrgId,
        source: 'chain',
      });
    });
  } else {
    log.info('[Server] GitHub connect disabled — set GITHUB_APP_* to enable');
  }

  // A failure to start must not stop the server coming up — the routes then
  // answer honestly that jobs aren't running.
  try {
    await jobs.start();
    log.info('[Server] background jobs running');
  } catch (err) {
    log.error(
      `[Server] background jobs failed to start (jobs will not process): ${(err as Error).message}`,
    );
  }

  // 6. Setup Express app + socket.io
  const app = createApp({ authVerifier: auth.verify, authRouter: auth.router, github, jobs });
  const httpServer = createServer(app);
  setupSocket(httpServer);

  // 7. Start listening
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
    stopAllWatchers();
    stopAllRunTails();
    httpServer.closeAllConnections();
    httpServer.close();
    // Stop the queue before the pool it runs on.
    await jobs.stop();
    await closeDb();
    log.info('[Server] Closed');
    await closeLogger();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // Fatal boot failure — logger may not be configured; fall back to stderr so
  // the operator always sees it. Then exit.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
