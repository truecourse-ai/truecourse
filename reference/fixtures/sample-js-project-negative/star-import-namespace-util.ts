/**
 * Negative fixture for code-quality/deterministic/star-import.
 *
 * A whole utility module is pulled in as a namespace when only a single
 * helper is used. This is not a namespace-oriented library — named imports
 * would be clearer and let the bundler tree-shake the rest away. This is the
 * real smell the rule flags.
 */

// VIOLATION: code-quality/deterministic/star-import
import * as stringKit from 'string-kit-toolkit';

export function shout(text: string): string {
  return stringKit.toUpperCase(text);
}
