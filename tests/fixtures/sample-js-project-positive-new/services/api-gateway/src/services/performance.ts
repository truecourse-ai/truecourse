import { logger } from '@sample/shared-utils';
const TEST_PATTERN = /^test/u;
export function matchPattern(item: string): boolean {
  return TEST_PATTERN.test(item);
}
export function chunkArray(arr: readonly number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
export function logMessage(msg: string): void {
  logger.info(msg);
}
