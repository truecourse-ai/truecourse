import { logger } from '@sample/shared-utils';
export function runMigration(name: string, sql: string): void {
  if (name.length === 0) throw new Error('Migration name required');
  logger.info(`Applied: ${name} (${sql.length} chars)`);
}
export function rollbackMigration(name: string): void {
  logger.info(`Rolled back: ${name}`);
}
