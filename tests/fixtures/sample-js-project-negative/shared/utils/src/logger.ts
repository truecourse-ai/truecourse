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
    // console.log inside a logger adapter is the implementation surface,
    // not a stray log — flagging it would be circular.
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
