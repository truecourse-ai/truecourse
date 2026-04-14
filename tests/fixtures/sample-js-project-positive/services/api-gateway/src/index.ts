import { authMiddleware } from './middleware/auth';
import { logger } from '@sample/shared-utils';
export function startApp(): void {
  logger.info(`Auth: ${typeof authMiddleware}`);
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});
