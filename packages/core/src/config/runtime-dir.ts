/**
 * The server's RUNTIME DIRECTORY — machine-local scratch, never state.
 *
 * Everything durable lives in Postgres. What lands here is what a process needs
 * a filesystem for and can lose without consequence: the per-run clones a job
 * works in, the live progress journals the run watcher tails, and the server's
 * own log. A booting process sweeps what a crashed one left behind.
 *
 * `TRUECOURSE_RUNTIME_DIR` relocates the whole directory (the container image
 * points it at its data volume); `TRUECOURSE_LOG_DIR` relocates the log alone,
 * for a deployment that collects logs from a fixed path.
 */

import os from 'node:os';
import path from 'node:path';

export function getRuntimeDir(): string {
  return process.env.TRUECOURSE_RUNTIME_DIR || path.join(os.homedir(), '.truecourse-runtime');
}

export function getLogDir(): string {
  return process.env.TRUECOURSE_LOG_DIR || path.join(getRuntimeDir(), 'logs');
}
