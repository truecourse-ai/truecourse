import { logger } from '@sample/shared-utils';
const HTTP_INTERNAL_ERROR = 500;
const HTTP_NOT_FOUND = 404;
export function getStatusCodes(): { internal: number; notFound: number } {
  return { internal: HTTP_INTERNAL_ERROR, notFound: HTTP_NOT_FOUND };
}
export function logError(message: string): void {
  logger.error(message);
}
