/**
 * Code-side query extraction output. Each adapter (knex / prisma /
 * raw-sql) produces ExtractedQuery records in this shape; the
 * QueryRule comparator diffs them against the spec-side contract.
 */

import type { ArtifactRef, Predicate, QualifiedColumn, SourceLocation } from '../../types/index.js';

export type QueryAdapterName = 'knex' | 'prisma' | 'raw-sql' | 'sqlalchemy' | 'django';

export interface ExtractedQuery {
  /** Operation this query is reachable from, when the extractor can
   *  trace it back through the handler chain. Unbound queries (helpers,
   *  jobs) may have this undefined. */
  operationBinding?: ArtifactRef;
  /** Table the query targets, plus the alias used at the source site
   *  (e.g. `from('jobs as j')` → `{table: 'jobs', alias: 'j'}`). */
  entity: { table?: string; alias?: string };
  predicates: Predicate[];
  dateRangeBinding?: { column: QualifiedColumn };
  /** Predicates the adapter couldn't normalize (sub-queries, custom
   *  functions, etc.). Preserved verbatim; surfaced as
   *  `query.unparseable.*` drifts by the comparator. */
  unparseable: { reason: string; raw: string }[];
  source: SourceLocation;
  adapter: QueryAdapterName;
}
