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



// FP shape: log level string in a single logger configuration (single-usage-false-trigger)
declare function getEnv(key: string): string | undefined;

interface TransportTarget {
  target: string;
  level: string;
  options?: Record<string, unknown>;
}

const transports: TransportTarget[] = [];

if (getEnv('NODE_ENV') !== 'production') {
  transports.push({
    target: 'pino-pretty',
    level: 'info',
  });
}

const logFilePath = getEnv('LOG_FILE_PATH');
if (logFilePath) {
  transports.push({
    target: 'pino/file',
    level: 'debug',
    options: { destination: logFilePath },
  });
}
