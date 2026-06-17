/**
 * Code-side validation-rule extraction output. Each guard the extractor
 * recognizes produces one record carrying the typed `ValidationRuleContract`
 * so the comparator can diff it against the spec-side lifted contract with
 * no further normalization.
 */

import type { SourceLocation, ValidationRuleContract } from '../../types/index.js';

export interface ExtractedValidationRule {
  /**
   * Stable identity for the rule, derived from the setting field +
   * target (`<setting>.required-when.<target>`). Lets the comparator
   * match the same rule across spec and code by structure rather than by
   * an author-chosen name.
   */
  identity: string;
  contract: ValidationRuleContract;
  source: SourceLocation;
}
