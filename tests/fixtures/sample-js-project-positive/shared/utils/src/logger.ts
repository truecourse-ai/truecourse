export function info(message: string): void {
  process.stdout.write(`[INFO] ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`[ERROR] ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`[WARN] ${message}\n`);
}

// Named exports are the canonical entrypoint; the `logger` object is a
// convenience alias kept so existing `logger.info(...)` call sites keep
// working without churn.
export const logger = { info, error, warn };
