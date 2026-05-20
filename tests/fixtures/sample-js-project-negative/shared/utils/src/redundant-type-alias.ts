/**
 * Paraphrased true-bug for code-quality/deterministic/redundant-type-alias.
 *
 * A top-level type alias that just renames another type without adding
 * any structure — exactly the wrapper-without-meaning the rule is for.
 */

import type { TEmailSettings } from './redundant-type-alias-source';

// VIOLATION: code-quality/deterministic/redundant-type-alias
export type EmailSettingsValue = TEmailSettings;
