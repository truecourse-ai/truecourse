/**
 * Paraphrased true-bug for reliability/deterministic/catch-without-error-type.
 *
 * The catch body branches on `err.code` — different error shapes lead to
 * different recovery behaviour. Without narrowing the error type (no
 * `instanceof` / `typeof` / no type annotation on the catch parameter),
 * the `err.code` access is unchecked and the branches may run against
 * unintended error shapes.
 */

import * as fs from 'fs';

export function readWithFallback(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8');
    // VIOLATION: reliability/deterministic/catch-without-error-type
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return '';
    }
    if ((err as { code?: string }).code === 'EACCES') {
      return 'denied';
    }
    throw err;
  }
}
