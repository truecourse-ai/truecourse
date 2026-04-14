import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../../api-gateway/src/middleware/auth';
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
export function validateInput(type: string, recipient: string): boolean {
  return type.length > 0 && recipient.length > 0;
}
export function getStatusCodes(): { bad: number; notFound: number } {
  return { bad: HTTP_BAD_REQUEST, notFound: HTTP_NOT_FOUND };
}
export function init(): void {
  logger.info(`Notification init: ${typeof authMiddleware}`);
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});
