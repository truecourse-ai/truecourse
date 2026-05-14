
// --- readonly-parameter-types FP: log rest param in logger interface ---
interface JobIO {
  runTask<T>(cacheKey: string, cb: () => Promise<T>): Promise<T>;
  logger: {
    info(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    log(...args: unknown[]): void;
  };
}

declare function defineJob<T>(opts: { id: string; handler: (options: { io: JobIO }) => Promise<void> }): typeof opts;
