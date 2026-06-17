/**
 * Code-side persistence-strategy extraction output.
 *
 * For a given per-feature setting/field, the extractor decides HOW the value
 * is stored: as a first-class schema column (a Prisma model field) — the
 * `dedicated-column` strategy — or as a key inside a JSON `metadata` blob —
 * the `metadata-json` strategy. This is a data-modeling/storage-strategy
 * decision (an ADR-grade choice), expressed as an `ArchitectureDecision`
 * under the `persistence-strategy` category so it diffs against an authored
 * decision the same way every other architecture choice does.
 *
 * The signal is structural and ORM/feature-agnostic:
 *   - dedicated-column: the field name is a scalar column on a schema model.
 *   - metadata-json:    the field name is read/written as a key on a JSON
 *                       blob identifier (`metadata`, `meta`) — `metadata.foo`,
 *                       `metadata["foo"]`, `{ ...metadata, foo: x }` — and is
 *                       NOT a real column.
 */

import type { SourceLocation } from '../../types/index.js';

export type PersistenceStrategyChoice = 'dedicated-column' | 'metadata-json';

export interface ExtractedPersistenceStrategy {
  /** The setting/field whose storage strategy was derived. */
  field: string;
  /** How the field is persisted, decided from code signals. */
  chosen: PersistenceStrategyChoice;
  /** Where the deciding signal lives (the column decl, or a blob access). */
  source: SourceLocation;
  /** Human-readable description of the deciding signal. */
  detail: string;
}
