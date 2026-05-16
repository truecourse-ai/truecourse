
// --- readonly-parameter-types FP: debug rest param in logger interface ---
interface DebugLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  log(...args: unknown[]): void;
}

function createDebugLogger(prefix: string): DebugLogger {
  return {
    debug: (...args) => console.debug(`[${prefix}]`, ...args),
    info: (...args) => console.info(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
    log: (...args) => console.log(`[${prefix}]`, ...args),
  };
}
