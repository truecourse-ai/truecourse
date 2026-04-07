/**
 * Architecture violations that are detected via code-level visitors (checkCodeRules).
 */

// VIOLATION: architecture/deterministic/declarations-in-global-scope
// Mutable global scope variable (let, not exported, not UPPER_CASE, not a function/class)
let globalCounter = 0;

// VIOLATION: architecture/deterministic/duplicate-import
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

// VIOLATION: architecture/deterministic/unused-import
import { join } from 'path';

// VIOLATION: architecture/deterministic/type-assertion-overuse
export function unsafeTypeAssertion(data: unknown) {
  const result = data as any;
  return result;
}

export function useImports() {
  const content = readFileSync('/tmp/test.txt', 'utf8');
  writeFileSync('/tmp/out.txt', content);
  return globalCounter++;
}
