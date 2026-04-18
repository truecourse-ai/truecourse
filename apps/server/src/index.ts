import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { createServer } from 'http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config/index.js';
import { setupSocket } from './socket/index.js';
import { errorHandler } from './middleware/error.js';
import { projectResolver } from './middleware/project.js';
import reposRouter from './routes/repos.js';
import analyzeRouter from './routes/analyze.js';
import analysesRouter from './routes/analyses.js';
import graphRouter from './routes/graph.js';
import filesRouter from './routes/files.js';
import violationsRouter from './routes/violations.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import flowsRouter from './routes/flows.js';
import analyticsRouter from './routes/analytics.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { wipeLegacyPostgresData, getLogDir } from './config/paths.js';
import { closeLogger, configureLogger, log } from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 0. Route all internal diagnostics to the dashboard log file. When running
  //    via `pnpm dev` the `TRUECOURSE_DEV=1` env var tees lines to stderr
  //    too so the dev terminal still shows them. Packaged dashboard (console
  //    or service) gets file-only output.
  configureLogger({
    filePath: path.join(getLogDir(), 'dashboard.log'),
    tee: process.env.TRUECOURSE_DEV === '1',
  });

  // 1. One-time cleanup of the pre-0.4 embedded-postgres data dir
  if (wipeLegacyPostgresData()) {
    log.info('[Storage] Legacy Postgres data wiped. Re-analyze to repopulate.');
  }

  log.info(`[LLM] Provider: claude-code, model: ${config.claudeCodeModel || 'default'}`);

  // 2. Setup Express app
  const app: express.Express = express();
  const httpServer = createServer(app);

  setupSocket(httpServer);

  app.use(cors());
  app.use(express.json());

  // Home page / registry routes run without a project.
  app.use('/api/repos', reposRouter);
  // Project-scoped routes. Each router's patterns declare their own `:id`
  // (e.g. `/:id/violations`), so we mount at `/api/repos` — the router
  // matches the `:id` segment itself. The resolver validates the slug and
  // touches `lastAccessed`.
  app.use('/api/repos', projectResolver, analyzeRouter);
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

  // 3. Serve static frontend (packaged mode)
  const staticDir = path.join(__dirname, 'public');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // 4. Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${config.port} is already in use. Is another TrueCourse instance running?\n` +
          `Stop it first, or set PORT to use a different port.`
        ));
      } else {
        reject(err);
      }
    });
    httpServer.listen(config.port, () => {
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
      log.info(`[Server] Listening on port ${config.port}`);
      resolve();
    });
  });

  // Graceful shutdown
  async function shutdown() {
    log.info('[Server] Shutting down...');
    stopAllWatchers();
    httpServer.closeAllConnections();
    httpServer.close();
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
