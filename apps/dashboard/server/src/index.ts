import { createServer } from 'http';
import path from 'node:path';
import '@truecourse/core/config/env';
import { setupSocket } from './socket/index.js';
import { createApp } from './app.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { wipeLegacyPostgresData, getLogDir } from '@truecourse/core/config/paths';
import { closeLogger, configureLogger, log } from '@truecourse/core/lib/logger';

const port = parseInt(process.env.PORT || '3001', 10);

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

  // 2. Setup Express app + socket.io
  const app = createApp();
  const httpServer = createServer(app);
  setupSocket(httpServer);

  // 3. Start listening
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
