import { createServer } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import '@truecourse/core/config/env';
import { setupSocket } from './socket/index.js';
import { createApp } from './app.js';
import { stopAllWatchers } from './services/watcher.service.js';
import { wipeLegacyPostgresData, getLogDir, getServerPortFilePath } from '@truecourse/core/config/paths';
import { closeLogger, configureLogger, log } from '@truecourse/core/lib/logger';

const DEFAULT_PORT = 3001;
const MAX_PORT_ATTEMPTS = 10;
const userSpecifiedPort = !!process.env.PORT;
const startPort = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

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

  // 3. Start listening — auto-selects the next free port if the default is
  //    reserved (common when Docker or a hypervisor has claimed it). If the
  //    user explicitly set PORT we respect that and fail immediately.
  let actualPort = startPort;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const candidate = startPort + attempt;
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        httpServer.removeListener('error', onError);
        httpServer.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        httpServer.removeListener('error', onError);
        resolve(true);
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(candidate);
    });

    if (bound) {
      actualPort = candidate;
      break;
    }

    if (userSpecifiedPort) {
      throw new Error(
        `Port ${candidate} is already in use.\n` +
        `Stop whatever is using it, or unset PORT to allow automatic port selection.`
      );
    }

    if (attempt === MAX_PORT_ATTEMPTS - 1) {
      throw new Error(
        `No available port found in range ${startPort}–${startPort + MAX_PORT_ATTEMPTS - 1}.\n` +
        `Set PORT to specify a different port.`
      );
    }

    log.warn(`[Server] Port ${candidate} is in use (possibly reserved by Docker or a hypervisor), trying ${candidate + 1}...`);
  }

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
  log.info(`[Server] Listening on port ${actualPort}`);

  // Write the actual port so the CLI can discover it when auto-selection fired
  const portFile = getServerPortFilePath();
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(actualPort), 'utf-8');

  // Graceful shutdown
  async function shutdown() {
    log.info('[Server] Shutting down...');
    stopAllWatchers();
    httpServer.closeAllConnections();
    httpServer.close();
    try { fs.unlinkSync(getServerPortFilePath()); } catch { /* already gone */ }
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
