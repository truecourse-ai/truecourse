export const logger = {
  info: (message: string): void => {
    process.stdout.write(`[INFO] ${message}\n`);
  },
  error: (message: string): void => {
    process.stderr.write(`[ERROR] ${message}\n`);
  },
  warn: (message: string): void => {
    process.stderr.write(`[WARN] ${message}\n`);
  },
};
