/**
 * Paraphrased true-bug for code-quality/deterministic/redundant-type-alias.
 *
 * A local, non-exported type alias whose name carries no structural-role
 * meaning (`Alias` suffix is generic) — exactly the wrapper-without-meaning
 * the rule is for.
 */

import type { TEmailSettings } from './redundant-type-alias-source';

// VIOLATION: code-quality/deterministic/redundant-type-alias
type EmailSettingsAlias = TEmailSettings;

// Local re-use so the alias isn't unreachable.
type _EmailAliasPair = [EmailSettingsAlias, EmailSettingsAlias];
export type EmailAliasPair = _EmailAliasPair;
