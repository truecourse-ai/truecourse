import { createServer } from 'http';
import path from 'node:path';
import '@truecourse/core/config/env';
import { setupSocket } from './socket/index.js';
import { createApp } from './app.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { wipeLegacyPostgresData, getLogDir } from '@truecourse/core/config/paths';
import { closeLogger, configureLogger, log } from '@truecourse/core/lib/logger';
import { DEFAULT_PORT_CANDIDATES } from '@truecourse/core/lib/port';

const port = parseInt(process.env.PORT || String(DEFAULT_PORT_CANDIDATES[0]), 10);

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

  // 2. Setup Express app + socket.io
  const app = createApp();
  const httpServer = createServer(app);
  setupSocket(httpServer);

  // 3. Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        reject(new Error(
          `Port ${port} is already in use or reserved by the OS.\n` +
          `On Windows this often means Hyper-V / Docker Desktop has reserved this port range\n` +
          `(check: netsh interface ipv4 show excludedportrange protocol=tcp).\n` +
          `Re-run \`truecourse dashboard\` so the CLI auto-picks a free port,\n` +
          `or set PORT=xxxx explicitly to pin a different port.`
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
