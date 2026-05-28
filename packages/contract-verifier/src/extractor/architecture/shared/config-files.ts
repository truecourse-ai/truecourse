/**
 * Shared signal collector: presence (and, when needed, content) of named
 * config files under the code dir. Used by detectors whose signals are
 * config files — `vite.config.ts`, `prisma/schema.prisma`,
 * `serverless.yml`, lockfiles, etc.
 */

import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from '../../../comparator/minimatch.js';
import { loadTcIgnore } from '@truecourse/shared';
import type { CodebaseScan, DetectionSignal } from '../types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse']);

export interface FileIndex {
  files: string[];
  readFile(relPath: string): string | null;
}

export function collectFileIndex(rootDir: string): FileIndex {
  const files: string[] = [];
  const cache = new Map<string, string | null>();
  const tcIgnore = loadTcIgnore(rootDir);
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.isFile()) files.push(path.relative(rootDir, full));
    }
  };
  visit(rootDir);
  return {
    files,
    readFile(relPath: string): string | null {
      if (cache.has(relPath)) return cache.get(relPath)!;
      let text: string | null;
      try {
        text = fs.readFileSync(path.join(rootDir, relPath), 'utf-8');
      } catch {
        text = null;
      }
      cache.set(relPath, text);
      return text;
    },
  };
}

/** Repo-relative paths matching `glob` — by full path OR by basename, so
 *  `vite.config.*` finds the file wherever it lives. */
function matchFiles(scan: CodebaseScan, glob: string): string[] {
  return scan.files.filter(
    (rel) => minimatch(rel, glob) || minimatch(path.basename(rel), glob),
  );
}

export function filesMatching(scan: CodebaseScan, globs: readonly string[]): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  for (const glob of globs) {
    for (const rel of matchFiles(scan, glob)) {
      out.push({
        kind: 'config-file',
        source: { filePath: rel, lineStart: 0, lineEnd: 0 },
        detail: `config file ${rel}`,
      });
    }
  }
  return out;
}

/** Config files matching `glob` whose content matches `pattern`. */
export function fileContentMatching(
  scan: CodebaseScan,
  globs: readonly string[],
  pattern: RegExp,
): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  for (const glob of globs) {
    for (const rel of matchFiles(scan, glob)) {
      const text = scan.readFile(rel);
      if (text && pattern.test(text)) {
        out.push({
          kind: 'config-file',
          source: { filePath: rel, lineStart: 0, lineEnd: 0 },
          detail: `${rel} matches /${pattern.source}/`,
        });
      }
    }
  }
  return out;
}
