import fs from 'node:fs';
import path from 'node:path';

/**
 * Pluggable diagnostics logger. Internal events (`[Pipeline]`, `[LLM]`, `[CLI]`,
 * the gate, …) go through `log.{info|warn|error}` and are routed to the active
 * TRANSPORT.
 *
 *   - OSS (CLI / local dashboard) installs a `FileLogTransport` — a rotating file
 *     (`<repo>/.truecourse/logs/analyze.log`, `~/.truecourse/logs/dashboard.log`),
 *     optionally tee'd to stderr under `pnpm dev`. Unchanged behaviour.
 *   - EE (hosted) installs its own transport (terminal + Sentry, no file) via
 *     `setLogTransport`.
 *
 * Tests configure nothing; the silent fallback drops messages so stdout stays
 * clean. `pushLogger`/`popLogger` temporarily route a request's logs into another
 * file (OSS analyze runs) — a file-transport concept.
 */

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * A log sink. The active transport receives every line; the OSS file transport
 * writes to disk, the EE transport writes to the terminal + Sentry. `err` carries
 * the original Error (when the caller passed one) so a transport can report a
 * real exception rather than a formatted string.
 */
export interface LogTransport {
  write(level: LogLevel, message: string, err?: unknown): void;
  /** Unprefixed block (startup banners). Falls back to per-line `write` if absent. */
  writeRaw?(block: string): void;
  /** Flush/close (file streams, Sentry). */
  close?(): void | Promise<void>;
}

/** The canonical line format, shared by any transport that renders to text. */
export function formatLogLine(level: LogLevel, message: string): string {
  return `[${new Date().toISOString()}] [${level}] ${message}`;
}

export interface LoggerConfig {
  filePath: string;
  /** Also echo every line to `process.stderr`. Used by `pnpm dev`. */
  tee?: boolean;
}

// ---------------------------------------------------------------------------
// File transport (OSS default)
// ---------------------------------------------------------------------------

/**
 * Size-based rotation: shift `.1` → `.2` → … → `.MAX`, drop the oldest, rename
 * the active file to `.1`. No-op under the size threshold or if absent.
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

export class FileLogTransport implements LogTransport {
  private readonly stream: fs.WriteStream;
  private failed = false;

  constructor(private readonly config: LoggerConfig) {
    fs.mkdirSync(path.dirname(config.filePath), { recursive: true });
    rotateLog(config.filePath);
    // Open synchronously and hand the descriptor to the stream. An unopenable
    // path fails HERE, at the caller installing the transport, and the open can
    // never land after that caller is gone; the descriptor also keeps the sink
    // writable for the whole run even if the directory is removed underneath it.
    const fd = fs.openSync(config.filePath, 'a');
    this.stream = fs.createWriteStream(config.filePath, { fd });
    // A write that fails mid-run (full disk, I/O error) degrades the sink and
    // says so on stderr — diagnostics must not kill the run they instrument.
    this.stream.on('error', (err: Error) => {
      this.failed = true;
      process.stderr.write(`[logger] ${config.filePath}: ${err.message}\n`);
    });
    this.stream.write(`\n--- ${new Date().toISOString()} ---\n`);
  }

  write(level: LogLevel, message: string): void {
    this.emit(formatLogLine(level, message) + '\n');
  }

  writeRaw(block: string): void {
    this.emit(block);
  }

  private emit(block: string): void {
    if (!this.failed) this.stream.write(block);
    if (this.config.tee) process.stderr.write(block);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.failed) {
        this.stream.destroy();
        resolve();
        return;
      }
      this.stream.end(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// Active-transport stack + public API
// ---------------------------------------------------------------------------

const stack: LogTransport[] = [];

function active(): LogTransport | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

function clearStack(): void {
  while (stack.length > 0) void stack.pop()?.close?.();
}

/** Install a file sink (OSS). Replaces the active stack. */
export function configureLogger(config: LoggerConfig): void {
  clearStack();
  stack.push(new FileLogTransport(config));
}

/** Install a custom transport (EE: terminal + Sentry). Replaces the active stack. */
export function setLogTransport(transport: LogTransport): void {
  clearStack();
  stack.push(transport);
}

/** Temporarily route logs into another file (OSS analyze run). */
export function pushLogger(config: LoggerConfig): void {
  stack.push(new FileLogTransport(config));
}

/** Await it: the run owns its log file until the flush completes. */
export function popLogger(): Promise<void> {
  return Promise.resolve(stack.pop()?.close?.());
}

export async function closeLogger(): Promise<void> {
  while (stack.length > 0) {
    await stack.pop()!.close?.();
  }
}

function emit(level: LogLevel, message: string, err?: unknown): void {
  active()?.write(level, message, err); // silent fallback for tests/unconfigured
}

function emitRaw(lines: string[]): void {
  const t = active();
  if (!t) return;
  const block = lines.join('\n') + '\n';
  if (t.writeRaw) t.writeRaw(block);
  else for (const line of lines) t.write('INFO', line);
}

export const log = {
  info(msg: string): void {
    emit('INFO', msg);
  },
  warn(msg: string): void {
    emit('WARN', msg);
  },
  /** `err` (optional) is forwarded to the transport so EE reports a real exception. */
  error(msg: string, err?: unknown): void {
    emit('ERROR', msg, err);
  },
  banner(lines: string[]): void {
    emitRaw(lines);
  },
};
