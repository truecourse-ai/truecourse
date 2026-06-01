/**
 * Query-extractor dispatcher. For each parsed source file, run the
 * matchers for its language and return the union of `ExtractedQuery`
 * records.
 *
 * Adapters are independent and named by the library they recognize
 * (knex / prisma / sqlalchemy / django) or `raw-sql` for the dialect
 * parser shared across hosts. Adding one (a new ORM, a new language) is a
 * pure addition: register a matcher in the language map, no comparator
 * changes (per PLAN_GAP_1_QUERY_RULE.md adapter contract).
 */

import { makeDirExtractor, jsMatchers, type ParsedSource } from '../source-walker.js';
import type { ExtractedQuery } from './types.js';
import { extractKnexQueriesFromFile } from './knex.js';
import { extractPrismaQueriesFromFile } from './prisma.js';
import { extractRawSqlQueriesFromFile, extractPythonRawSqlQueriesFromFile } from './raw-sql.js';
import { extractSqlalchemyQueriesFromFile } from './sqlalchemy.js';
import { extractDjangoQueriesFromFile } from './django.js';

export type { ExtractedQuery, QueryAdapterName } from './types.js';

function jsQueries(s: ParsedSource): ExtractedQuery[] {
  return [
    ...extractKnexQueriesFromFile(s.filePath, s.source, s.tree),
    ...extractPrismaQueriesFromFile(s.filePath, s.source, s.tree),
    ...extractRawSqlQueriesFromFile(s.filePath, s.source, s.tree),
  ];
}

function pythonQueries(s: ParsedSource): ExtractedQuery[] {
  return [
    ...extractSqlalchemyQueriesFromFile(s.filePath, s.source, s.tree),
    ...extractDjangoQueriesFromFile(s.filePath, s.source, s.tree),
    ...extractPythonRawSqlQueriesFromFile(s.filePath, s.source, s.tree),
  ];
}

export const extractQueriesFromDir = makeDirExtractor<ExtractedQuery>({
  ...jsMatchers(jsQueries),
  python: pythonQueries,
});
