import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { createServer } from 'http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config/index.js';
import { initDatabase, closeDatabase, getClient } from './config/database.js';
import { migratePGlite } from './config/migrate.js';
import {
  resolveRepoDir,
  ensureRepoTruecourseDir,
  getRepoDbDir,
  wipeLegacyPostgresData,
} from './config/paths.js';
import { setupSocket } from './socket/index.js';
import { errorHandler } from './middleware/error.js';
import reposRouter from './routes/repos.js';
import analysisRouter from './routes/analysis.js';
import violationsRouter from './routes/violations.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import flowsRouter from './routes/flows.js';
import analyticsRouter from './routes/analytics.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { seedRules } from './services/rules.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir(): string {
  if (process.env.TRUECOURSE_DATA_DIR) {
    return process.env.TRUECOURSE_DATA_DIR;
  }
  const repoDir = resolveRepoDir(process.cwd());
  if (!repoDir) {
    throw new Error(
      `No .truecourse/ directory found walking up from ${process.cwd()}.\n` +
        `Run \`truecourse analyze\` from inside a project to initialize storage, ` +
        `or set TRUECOURSE_DATA_DIR to point at an explicit PGlite directory.`,
    );
  }
  ensureRepoTruecourseDir(repoDir);
  return getRepoDbDir(repoDir);
}

async function main() {
  // 0. One-time cleanup of the pre-PGlite embedded-postgres data dir
  if (wipeLegacyPostgresData()) {
    console.log('[Storage] Legacy Postgres data wiped. Re-analyze to repopulate.');
  }

  // 1. Initialize PGlite at the per-repo data directory
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  await initDatabase(dataDir);
  console.log(`[Database] PGlite ready at ${dataDir}`);

  // 2. Run migrations
  // In dev: migrations are at ../src/db/migrations relative to src/
  // In packaged mode: migrations are at ./db/migrations relative to dist/server.mjs
  const devMigrations = path.join(__dirname, '../src/db/migrations');
  const distMigrations = path.join(__dirname, 'db/migrations');
  const migrationsFolder = fs.existsSync(distMigrations) ? distMigrations : devMigrations;
  await migratePGlite(getClient(), migrationsFolder);
  console.log('[Database] Migrations complete');

  // 3. Seed default rules (upserts — safe to run every startup)
  await seedRules();
  console.log('[Database] Rules seeded');
  console.log(`[LLM] Provider: claude-code, model: ${config.claudeCodeModel || 'default'}`);

  // 4. Setup Express app
  const app: express.Express = express();
  const httpServer = createServer(app);

  setupSocket(httpServer);

  app.use(cors());
  app.use(express.json());

  app.use('/api/repos', reposRouter);
  app.use('/api/repos', analysisRouter);
  app.use('/api/repos', violationsRouter);
  app.use('/api/repos', databasesRouter);
  app.use('/api/repos', flowsRouter);
  app.use('/api/repos', analyticsRouter);
  app.use('/api/rules', rulesRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);

  // 5. Serve static frontend (packaged mode)
  // In bundled mode, public/ is a sibling of server.mjs
  const staticDir = path.join(__dirname, 'public');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // 6. Start listening
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
    await closeDatabase();
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
