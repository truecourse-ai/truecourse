import fs from 'node:fs';
import path from 'node:path';

/**
 * Lightweight file logger with size-based rotation. Internal diagnostics
 * (`[Pipeline]`, `[LLM]`, `[CLI]`, etc.) go through `log.{info|warn|error}`
 * and are routed to whichever file the calling entry point configured.
 *
 * Entry-point wiring:
 *   - `truecourse analyze` → `<repo>/.truecourse/logs/analyze.log`
 *   - dashboard server boot → `~/.truecourse/logs/dashboard.log`
 *   - dashboard's `POST /analyze` route → pushes the target repo's
 *     `analyze.log` for the duration of the request, then pops back
 *     to `dashboard.log` so route-level events stay at the server level.
 *
 * Tests don't call `configureLogger`; the silent fallback drops messages
 * so their stdout stays clean.
 */

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

export interface LoggerConfig {
  filePath: string;
  /** Also echo every line to `process.stderr`. Used by `pnpm dev`. */
  tee?: boolean;
}

interface ActiveSink {
  config: LoggerConfig;
  stream: fs.WriteStream;
}

const stack: ActiveSink[] = [];

/**
 * Size-based rotation: shift `.1` → `.2` → … → `.MAX`, drop the oldest,
 * rename the active file to `.1`. No-op if the file is under the size
 * threshold or doesn't exist yet.
 */
export function rotateLog(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stats = fs.statSync(filePath);
  if (stats.size < MAX_LOG_SIZE) return;

  for (let i = MAX_LOG_FILES; i >= 1; i--) {
    const older = `${filePath}.${i}`;
    if (i === MAX_LOG_FILES) {
      if (fs.existsSync(older)) fs.unlinkSync(older);
    } else {
      const newer = `${filePath}.${i + 1}`;
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function openSink(config: LoggerConfig): ActiveSink {
  fs.mkdirSync(path.dirname(config.filePath), { recursive: true });
  rotateLog(config.filePath);
  const stream = fs.createWriteStream(config.filePath, { flags: 'a' });
  stream.write(`\n--- ${new Date().toISOString()} ---\n`);
  return { config, stream };
}

/** Install the logger as the active sink. Call once per entry point. */
export function configureLogger(config: LoggerConfig): void {
  // Replace any currently-active sink. Close previous streams so we don't
  // leak file handles on re-configure (which happens during `tsx watch`).
  while (stack.length > 0) {
    const sink = stack.pop();
    sink?.stream.end();
  }
  stack.push(openSink(config));
}

/**
 * Temporarily switch the sink (e.g. route an analyze request's logs into
 * the target repo's `analyze.log`). Returns a handle the caller uses to
 * restore the previous sink.
 */
export function pushLogger(config: LoggerConfig): void {
  stack.push(openSink(config));
}

export function popLogger(): void {
  const sink = stack.pop();
  sink?.stream.end();
}

export async function closeLogger(): Promise<void> {
  while (stack.length > 0) {
    const sink = stack.pop()!;
    await new Promise<void>((resolve) => sink.stream.end(resolve));
  }
}

function currentSink(): ActiveSink | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

function emit(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  const sink = currentSink();
  if (!sink) return; // silent fallback for tests + unconfigured contexts
  sink.stream.write(line);
  if (sink.config.tee) process.stderr.write(line);
}

/**
 * Write `lines` as-is (no timestamp/level prefix) to the active sink. Used
 * for startup banners where the usual prefix would wreck ASCII alignment.
 * Still written to the log file and, if tee'd, to stderr.
 */
function emitRaw(lines: string[]): void {
  const sink = currentSink();
  if (!sink) return;
  const block = lines.join('\n') + '\n';
  sink.stream.write(block);
  if (sink.config.tee) process.stderr.write(block);
}

export const log = {
  info(msg: string): void {
    emit('INFO', msg);
  },
  warn(msg: string): void {
    emit('WARN', msg);
  },
  error(msg: string): void {
    emit('ERROR', msg);
  },
  banner(lines: string[]): void {
    emitRaw(lines);
  },
};
