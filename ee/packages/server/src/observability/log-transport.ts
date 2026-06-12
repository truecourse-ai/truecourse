/**
 * The EE log transport — installed over the core logger (replacing the OSS file
 * sink) so the hosted server's logs go to the TERMINAL and its ERRORS go to
 * SENTRY, with no log file.
 *
 *   - every line → stdout (info/warn) or stderr (error), always (not just dev)
 *   - ERROR → `captureEeException` (a real exception when the caller passed one,
 *     else a synthesized Error from the message), tagged with the subsystem
 *     inferred from the message `[prefix]`
 *   - info/warn never reach Sentry (breadcrumbs are disabled there for secret
 *     safety — see sentry.ts); they're terminal-only
 *
 * This also closes the gate's Sentry gap for free: `gate-handler` already calls
 * `log.error(...)`, which now egresses to Sentry through this transport — no
 * upward import from `ee-github-app` into `ee-server` needed.
 */

import { formatLogLine, type LogLevel, type LogTransport } from '@truecourse/core/lib/logger';
import { captureEeException, type EeComponent } from './sentry.js';

/** Best-effort Sentry component from a log message's `[prefix]`. */
function componentFor(message: string): EeComponent {
  if (message.includes('[github-app]') || message.includes('[gate')) return 'github-gate';
  if (message.includes('[knowledge') || message.includes('[connector')) return 'knowledge';
  if (message.includes('[llm') || message.includes('[transport')) return 'llm';
  if (message.includes('[integration')) return 'integrations';
  return 'server';
}

export class EeLogTransport implements LogTransport {
  write(level: LogLevel, message: string, err?: unknown): void {
    const line = formatLogLine(level, message) + '\n';
    (level === 'ERROR' ? process.stderr : process.stdout).write(line);
    if (level === 'ERROR') {
      captureEeException(err ?? new Error(message), { component: componentFor(message) });
    }
  }

  writeRaw(block: string): void {
    process.stdout.write(block);
  }
}
