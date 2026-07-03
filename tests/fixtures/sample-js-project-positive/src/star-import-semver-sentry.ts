/**
 * Positive fixture for code-quality/deterministic/star-import.
 *
 * `semver` and the error-reporting SDK are designed to be consumed under a
 * namespace alias (`semver.satisfies(...)`, `Sentry.captureException(...)`).
 * A namespace import is the idiomatic, documented usage for these packages —
 * the same carve-out the rule already makes for `zod` and `react` — so even
 * when the alias is referenced only once or twice, flagging `import * as`
 * here is a false positive.
 */

import * as semver from 'semver';
import * as Sentry from '@sentry/node';

export function isCompatibleVersion(version: string): boolean {
  return semver.satisfies(version, '>=1.0.0');
}

export function reportError(error: unknown): void {
  Sentry.captureException(error);
}
