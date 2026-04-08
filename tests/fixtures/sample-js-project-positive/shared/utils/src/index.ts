export { formatUser } from './formatters';
export { validateEmail, validateName } from './validators';
export { logger } from './logger';

process.on('uncaughtException', (err: Error) => {
  console.error(`Uncaught: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error(`Unhandled: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});
