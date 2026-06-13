/**
 * Code-side fallback extraction output. Each null/absent → default
 * coalescing site the extractor recognizes produces one record carrying the
 * typed `FallbackContract`, so the comparator can diff it against the
 * spec-side lifted contract with no further normalization.
 */

import type { FallbackContract, SourceLocation } from '../../types/index.js';

export interface ExtractedFallback {
  /**
   * Stable identity for the fallback, derived from the target field
   * (`<field>.fallback`). Lets the comparator match the same coalescing
   * rule across spec and code by structure rather than by an author-chosen
   * name.
   */
  identity: string;
  contract: FallbackContract;
  source: SourceLocation;
}
