
// --- readonly-parameter-types FP: rest param ...args: unknown[] in interface method ---
// The rule should not flag rest parameters as they capture variadic args (not mutated)
interface JobLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  log(...args: unknown[]): void;
}

interface JobRunIO {
  runTask<T>(cacheKey: string, callback: () => Promise<T>): Promise<T>;
  logger: JobLogger;
}
