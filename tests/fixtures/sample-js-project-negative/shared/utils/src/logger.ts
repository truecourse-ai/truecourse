// VIOLATION: architecture/deterministic/dead-module
// VIOLATION: code-quality/deterministic/unsafe-any-usage
const config: any = {};
config.level;

export const logger = {
  // VIOLATION: architecture/deterministic/dead-method
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  info: (message: string) => {
    const meta: any = {};
    meta.timestamp;
    // VIOLATION: code-quality/deterministic/console-log
    console.log(`[INFO] ${message}`);
  },
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  error: (message: string) => {
    const ctx: any = {};
    ctx.stack;
    console.error(`[ERROR] ${message}`);
  },
  warn: (message: string) => {
    console.warn(`[WARN] ${message}`);
  },
};
