/**
 * Enum extractor dispatcher. Walks a directory, parses each JS/TS
 * file, runs the enum-shape adapter, and returns deduped
 * `ExtractedEnum` records.
 *
 * Dedup key: `(name, sorted-values)` — the same enum often appears as
 * both a type alias AND a Zod schema validating it; collapse them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type { ExtractedEnum } from './types.js';
import { extractEnumsFromFile } from './ts-enums.js';

export type { ExtractedEnum, EnumShape } from './types.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

export async function extractEnumsFromDir(rootDir: string): Promise<ExtractedEnum[]> {
  await initParsers();
  const raw: ExtractedEnum[] = [];

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
        raw.push(...extractEnumsFromFile(full, source, tree));
      } catch {
        // Parse failure on one file is non-fatal.
      }
    }
  };
  visit(rootDir);

  // Dedup by (name, value-set).
  const seen = new Map<string, ExtractedEnum>();
  for (const e of raw) {
    const key = `${e.name}|${e.values.join(',')}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}
