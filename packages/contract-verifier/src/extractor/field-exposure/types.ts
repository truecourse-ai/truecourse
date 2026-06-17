/**
 * Code-side field-exposure extraction output. Each field the extractor sees
 * included in a read-path projection (ORM select) or an API response shape
 * produces one record carrying the typed `FieldExposureContract`, so the
 * comparator can diff it against the spec-side lifted contract with no further
 * normalization.
 */

import type { FieldExposureContract, SourceLocation } from '../../types/index.js';

export interface ExtractedFieldExposure {
  /**
   * Stable identity for the exposure, derived from the field name
   * (`<field>.exposure`). Lets the comparator match the same field's
   * exposure across spec and code by structure rather than by an
   * author-chosen name. A field exposed via both channels collapses to one
   * record carrying both in `contract.exposedVia`.
   */
  identity: string;
  contract: FieldExposureContract;
  source: SourceLocation;
}
