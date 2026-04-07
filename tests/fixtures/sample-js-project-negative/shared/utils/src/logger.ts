export const logger = {
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  info: (message: string, ...args: any[]) => {
    // VIOLATION: code-quality/deterministic/console-log
    console.log(`[INFO] ${message}`, ...args);
  },
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  warn: (message: string, ...args: any[]) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
};
