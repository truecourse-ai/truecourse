/**
 * Paraphrased true-bug for code-quality/deterministic/star-import.
 *
 * `import * as fs from 'node:fs'` pulls the entire fs module's runtime
 * surface, but the caller only references one or two functions. A
 * named import is strictly better for tree-shaking and readability;
 * the rule should still fire here.
 */

// VIOLATION: code-quality/deterministic/star-import
import * as fileSystem from 'node:fs';

export function readGreeting(path: string): string {
  return fileSystem.readFileSync(path, 'utf-8');
}
