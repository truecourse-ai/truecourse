import { authMiddleware } from './middleware/auth';
import { logger } from '@sample/shared-utils';
import { describeGateway } from './services/wiring';
export function startApp(): void {
  logger.info(`Auth: ${typeof authMiddleware}`);
  const summary = describeGateway('127.0.0.1');
  logger.info(`Gateway ready: ${summary.userIndex}`);
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});
