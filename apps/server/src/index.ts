import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { createServer } from 'http';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config/index.js';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from './config/embedded-postgres.js';
import { initDatabase, closeDatabase } from './config/database.js';
import { setupSocket } from './socket/index.js';
import { errorHandler } from './middleware/error.js';
import reposRouter from './routes/repos.js';
import analysisRouter from './routes/analysis.js';
import violationsRouter from './routes/insights.js';
import chatRouter from './routes/chat.js';
import databasesRouter from './routes/databases.js';
import rulesRouter from './routes/rules.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { seedRules } from './services/rules.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Start embedded PostgreSQL (no-op if DATABASE_URL is set)
  const databaseUrl = await startEmbeddedPostgres();
  console.log(`[Database] Connected: ${databaseUrl.replace(/\/\/.*@/, '//<credentials>@')}`);

  // 2. Initialize database connection
  initDatabase(databaseUrl);

  // 3. Run migrations
  const migrationClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(migrationClient), {
    migrationsFolder: path.join(__dirname, '../src/db/migrations'),
  });
  await migrationClient.end();
  console.log('[Database] Migrations complete');

  // 3b. Seed default rules (upserts — safe to run every startup)
  await seedRules();
  console.log('[Database] Rules seeded');

  // 4. Setup Express app
  const app: express.Express = express();
  const httpServer = createServer(app);

  setupSocket(httpServer);

  app.use(cors());
  app.use(express.json());

  app.use('/api/repos', reposRouter);
  app.use('/api/repos', analysisRouter);
  app.use('/api/repos', violationsRouter);
  app.use('/api/repos', chatRouter);
  app.use('/api/repos', databasesRouter);
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
    // SPA fallback — serve index.html for non-API routes
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
      console.log(`   Open http://localhost:${config.port} to sail`);
      console.log('');
      console.log('   To analyze a repo from your terminal:');
      console.log('     cd /path/to/your/repo');
      console.log('     npx truecourse analyze');
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
    await stopEmbeddedPostgres();
    console.log('[Server] Closed');
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
