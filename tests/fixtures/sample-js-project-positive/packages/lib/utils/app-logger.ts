
declare function appLog(context: string, ...args: unknown[]): void;

class ServiceLogger {
  public context: string;

  constructor(context: string) {
    this.context = context;
  }

  public log(...args: unknown[]) {
    appLog(this.context, ...args);
  }

  public warn(...args: unknown[]) {
    appLog(this.context, '[warn]', ...args);
  }
}



// Env-guarded debug utility — console.log is guarded by a process.env check.
// Intentional conditional debug output infrastructure, not stray logging.
declare function getEnv(key: string): string | undefined;

export function appLog(context: string, message: string, ...rest: unknown[]): void {
  if (getEnv('APP_DEBUG') === 'true') {
    console.log(`[${context}]: ${message}`, ...rest);
  }
}
