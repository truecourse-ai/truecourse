
// --- readonly-parameter-types FP: info rest param in logger interface ---
interface WorkerLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
}

interface WorkerRunIO {
  logger: WorkerLogger;
  runTask<T>(cacheKey: string, cb: () => Promise<T>): Promise<T>;
}

declare const worker: { define(opts: { id: string; handler: (io: WorkerRunIO) => Promise<void> }): void };
