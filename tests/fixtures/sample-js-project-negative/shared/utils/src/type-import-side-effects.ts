/**
 * Negative fixture for code-quality/deterministic/type-import-side-effects.
 *
 * When every named import is an inline `type` specifier AND there is
 * no default / namespace value import, the whole `import { type X }`
 * still loads the module for no value. The rule should fire — the
 * fix is to switch to `import type { X }`.
 */

// VIOLATION: code-quality/deterministic/type-import-side-effects
import { type RowShape } from 'csv-parser-stub';

export function describeShape(row: RowShape): string {
  return JSON.stringify(row);
}
