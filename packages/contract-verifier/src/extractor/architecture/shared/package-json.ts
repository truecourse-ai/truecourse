/**
 * Shared signal collector: declared dependencies across every
 * package.json under the code dir. Used by every architecture detector
 * whose signals include npm packages.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CodebaseScan, DeclaredPackage, DetectionSignal } from '../types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.truecourse']);
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function collectDeclaredPackages(rootDir: string): DeclaredPackage[] {
  const out: DeclaredPackage[] = [];
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
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.name !== 'package.json') continue;
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(fs.readFileSync(full, 'utf-8'));
      } catch {
        continue;
      }
      for (const field of DEP_FIELDS) {
        const deps = pkg[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, version] of Object.entries(deps as Record<string, string>)) {
          out.push({
            name,
            version: typeof version === 'string' ? version : '',
            field,
            source: { filePath: full, lineStart: 0, lineEnd: 0 },
          });
        }
      }
    }
  };
  visit(rootDir);
  return out;
}

/**
 * Packages in the scan whose name is in `names`. Exact match — npm
 * package names are exact identifiers, so substring matching would
 * misfire (`pg` vs `pg-pool`).
 */
export function packagesMatching(scan: CodebaseScan, names: readonly string[]): DetectionSignal[] {
  const want = new Set(names);
  const out: DetectionSignal[] = [];
  for (const p of scan.packages) {
    if (want.has(p.name)) {
      out.push({
        kind: 'package',
        source: p.source,
        detail: `${p.name} (${p.field})`,
      });
    }
  }
  return out;
}
