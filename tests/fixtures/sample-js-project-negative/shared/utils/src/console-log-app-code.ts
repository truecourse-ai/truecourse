declare const console: {
  log(message?: unknown, ...optional: unknown[]): void;
  debug(message?: unknown, ...optional: unknown[]): void;
};

export function processOrder(orderId: string): void {
  // VIOLATION: code-quality/deterministic/console-log
  console.log(`processing order ${orderId}`);
}
