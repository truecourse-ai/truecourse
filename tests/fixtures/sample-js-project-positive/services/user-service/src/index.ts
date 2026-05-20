import { authMiddleware } from '../../api-gateway/src/middleware/auth';
import { logger } from '@sample/shared-utils';
import { getStatusCodes, validateEmail } from './handlers/user.handler';
export function startUserService(): void {
  logger.info(`User service: ${typeof authMiddleware}`);
  const codes = getStatusCodes();
  if (!validateEmail('user@example.com')) {
    logger.warn(`Invalid sample email; codes=${codes.badRequest}`);
  }
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});
