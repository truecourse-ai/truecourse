/**
 * Paraphrased true-bug for code-quality/deterministic/star-import.
 *
 * A namespace import of a value module (not type-only) pulls the entire
 * module's runtime surface. The caller only needs one helper, so a named
 * import is strictly better for tree-shaking and readability.
 */

// VIOLATION: code-quality/deterministic/star-import
import * as csvParser from 'csv-parser';

export function getParser(): unknown {
  return csvParser;
}
