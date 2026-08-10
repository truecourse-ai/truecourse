/**
 * Paraphrased true-bug for architecture/deterministic/duplicate-import.
 *
 * Two named imports from the same module on adjacent lines — the canonical
 * case the rule is meant to catch. These ARE merge-able into a single
 * `import { a, b } from 'm'` statement.
 */

// VIOLATION: architecture/deterministic/duplicate-import
import { validateEmail } from '@sample/shared-utils';
import { validateName } from '@sample/shared-utils';

export function checkContact(email: string, name: string): boolean {
  return validateEmail(email) && validateName(name);
}
