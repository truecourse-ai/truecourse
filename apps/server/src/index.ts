import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { createServer } from 'http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config/index.js';
import { closeAllProjectDbs, configureMigrations } from './config/database.js';
import { setupSocket } from './socket/index.js';
import { errorHandler } from './middleware/error.js';
import { projectResolver } from './middleware/project.js';
import reposRouter from './routes/repos.js';
import analysisRouter from './routes/analysis.js';
import violationsRouter from './routes/violations.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import flowsRouter from './routes/flows.js';
import analyticsRouter from './routes/analytics.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { wipeLegacyPostgresData } from './config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 0. One-time cleanup of the pre-PGlite embedded-postgres data dir
  if (wipeLegacyPostgresData()) {
    console.log('[Storage] Legacy Postgres data wiped. Re-analyze to repopulate.');
  }

  // 1. Tell the DB module where migration SQL lives. Per-project PGlite
  //    instances are opened lazily on first request and migrated on open.
  const devMigrations = path.join(__dirname, '../src/db/migrations');
  const distMigrations = path.join(__dirname, 'db/migrations');
  configureMigrations(fs.existsSync(distMigrations) ? distMigrations : devMigrations);
  console.log(`[LLM] Provider: claude-code, model: ${config.claudeCodeModel || 'default'}`);

  // 2. Setup Express app
  const app: express.Express = express();
  const httpServer = createServer(app);

  setupSocket(httpServer);

  app.use(cors());
  app.use(express.json());

  // Home page / registry routes run without a project DB.
  app.use('/api/repos', reposRouter);
  // Project-scoped routes: resolve `:id` → open PGlite → bind to request
  // async context. Handlers use the shared `db` proxy which reads from ALS.
  app.use('/api/repos/:id', projectResolver, analysisRouter);
  app.use('/api/repos/:id', projectResolver, violationsRouter);
  app.use('/api/repos/:id', projectResolver, databasesRouter);
  app.use('/api/repos/:id', projectResolver, flowsRouter);
  app.use('/api/repos/:id', projectResolver, analyticsRouter);
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
      console.log('');
      console.log('         _|_');
      console.log('        /_|_\\');
      console.log('          |');
      console.log('         /|');
      console.log('        / |');
      console.log('       /  |');
      console.log('      /   |');
      console.log('     /    |');
      console.log('    /_____|_____\\');
      console.log('    \\__________|');
      console.log('     \\_________/');
      console.log('   ~~~~~~~~~~~~~~');
      console.log('');
      console.log(`   Charting your course...`);
      console.log('');
      resolve();
    });
  });

  // Graceful shutdown
  async function shutdown() {
    console.log('\n[Server] Shutting down...');
    stopAllWatchers();
    httpServer.closeAllConnections();
    httpServer.close();
    await closeAllProjectDbs();
    console.log('[Server] Closed');
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
