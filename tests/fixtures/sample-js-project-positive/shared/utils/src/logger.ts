export const logger = {
  info: (message: string, ...args: readonly unknown[]): void => {
    console.info(`[INFO] ${message}`, ...args);
  },
  error: (message: string, ...args: readonly unknown[]): void => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  warn: (message: string, ...args: readonly unknown[]): void => {
    console.warn(`[WARN] ${message}`, ...args);
  },
};
