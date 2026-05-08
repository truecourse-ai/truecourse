/**
 * console-log shape that should NOT fire:
 *
 * Logger adapter object whose properties forward to console.
 * The `console.log` is the implementation of the logger
 * surface — replacing it with another logger would be
 * circular.
 */

export const consoleLogger = {
  log: (msg: string): void => console.log(msg),
  debug: (msg: string): void => console.debug(msg),
};

export function useLogger(): typeof consoleLogger {
  return consoleLogger;
}
