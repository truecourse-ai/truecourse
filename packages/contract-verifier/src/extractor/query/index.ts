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

import { eachParsedSource, makeDirExtractor, jsMatchers, type ParsedSource } from '../source-walker.js';
import { csColumnMap } from '../shared/cs-column-map.js';
import type { ExtractedQuery } from './types.js';
import { extractKnexQueriesFromFile } from './knex.js';
import { extractPrismaQueriesFromFile } from './prisma.js';
import { extractRawSqlQueriesFromFile, extractPythonRawSqlQueriesFromFile } from './raw-sql.js';
import { extractSqlalchemyQueriesFromFile } from './sqlalchemy.js';
import { extractDjangoQueriesFromFile } from './django.js';
import { extractEfcoreQueriesFromFile } from './efcore.js';
import { extractDapperQueriesFromFile } from './dapper.js';

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

const jsAndPython = makeDirExtractor<ExtractedQuery>({
  ...jsMatchers(jsQueries),
  python: pythonQueries,
});

export async function extractQueriesFromDir(rootDir: string): Promise<ExtractedQuery[]> {
  const out = await jsAndPython(rootDir);
  // C# needs a cross-file pre-pass: the property→[Column] map lives in the entity
  // files, the queries in the repository files. Build the (memoised) column map,
  // then run the EF Core + Dapper matchers so each LINQ property access resolves
  // to its snake_case column.
  const columns = await csColumnMap(rootDir);
  await eachParsedSource(rootDir, (s) => {
    if (s.lang !== 'csharp') return;
    out.push(...extractEfcoreQueriesFromFile(s.filePath, s.source, s.tree, columns));
    out.push(...extractDapperQueriesFromFile(s.filePath, s.source, s.tree));
  });
  return out;
}
