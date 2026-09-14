import type { LogLevel, LogTransport } from '@truecourse/core/lib/logger';
import { captureServerException, flushSentry } from './sentry.js';

/** Preserve the configured file sink and send only errors to optional Sentry. */
export class ServerLogTransport implements LogTransport {
  constructor(private readonly output: LogTransport) {}

  write(level: LogLevel, message: string, error?: unknown): void {
    this.output.write(level, message, error);
    if (level === 'ERROR') captureServerException(error ?? new Error(message));
  }

  writeRaw(block: string): void {
    if (this.output.writeRaw) this.output.writeRaw(block);
    else this.output.write('INFO', block);
  }

  async close(): Promise<void> {
    try {
      await this.output.close?.();
    } finally {
      await flushSentry();
    }
  }
}
