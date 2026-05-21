/**
 * Positive fixture for code-quality/deterministic/deprecated-api-usage.
 *
 * Import alias that shadows a locally-deprecated name: importing `hashLegacy`
 * from an external module under a different alias has nothing to do with a
 * same-named deprecated symbol in this file. Identifiers inside an
 * `import_statement` always refer to external symbols and must be skipped.
 */

import { hashLegacy as externalHashLegacy } from 'sample-crypto-shim';

const DEFAULT_ROUNDS = 10;

/**
 * @deprecated Prefer the native crypto helpers exposed by `hashWithSalt`.
 */
export const hashLegacy = (password: string): string => {
  return externalHashLegacy(password, DEFAULT_ROUNDS);
};
