/**
 * Constant extractor dispatcher. Walks a directory, parses each
 * JS/TS file, runs the constant-shape adapter, and returns deduped
 * `ExtractedConstant` records.
 *
 * Dedup key: `(name, stringified value)` — same constant in multiple
 * files collapses to one record. The first source location wins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type { ExtractedConstant } from './types.js';
import { extractConstantsFromFile } from './ts-constants.js';

export type { ExtractedConstant, ConstantShape } from './types.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse']);

export async function extractConstantsFromDir(rootDir: string): Promise<ExtractedConstant[]> {
  await initParsers();
  const raw: ExtractedConstant[] = [];

  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
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
        raw.push(...extractConstantsFromFile(full, source, tree));
      } catch {
        // Parse failures non-fatal.
      }
    }
  };
  visit(rootDir);

  // Dedup by (name, serialized-value). Keep first occurrence.
  const seen = new Map<string, ExtractedConstant>();
  for (const c of raw) {
    const key = `${c.name}|${JSON.stringify(c.value)}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}
