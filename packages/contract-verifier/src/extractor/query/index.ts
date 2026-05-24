/**
 * Query-extractor dispatcher. Walks a directory, parses each JS/TS
 * file, runs each adapter (knex / prisma / raw-sql) over the AST, and
 * returns the union of `ExtractedQuery` records.
 *
 * Adapters are independent — adding a new one is a pure addition with
 * no comparator changes (per PLAN_GAP_1_QUERY_RULE.md adapter contract).
 */

import fs from 'node:fs';
import path from 'node:path';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type { ExtractedQuery } from './types.js';
import { extractKnexQueriesFromFile } from './knex.js';
import { extractPrismaQueriesFromFile } from './prisma.js';
import { extractRawSqlQueriesFromFile } from './raw-sql.js';

export type { ExtractedQuery, QueryAdapterName } from './types.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

export async function extractQueriesFromDir(rootDir: string): Promise<ExtractedQuery[]> {
  await initParsers();
  const out: ExtractedQuery[] = [];

  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!TS_EXT.has(ext)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const lang =
        ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
      try {
        const tree = parseFile(full, source, lang);
        out.push(...extractKnexQueriesFromFile(full, source, tree));
        out.push(...extractPrismaQueriesFromFile(full, source, tree));
        out.push(...extractRawSqlQueriesFromFile(full, source, tree));
      } catch {
        // Parse failure on one file is non-fatal — same convention as
        // extractOperationsFromDir.
      }
    }
  };
  visit(rootDir);
  return out;
}
