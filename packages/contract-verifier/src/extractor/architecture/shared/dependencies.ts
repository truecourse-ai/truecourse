/**
 * Shared signal collector: declared dependencies across every package
 * manifest under the code dir (npm package.json, Python requirements /
 * pyproject / setup.py — see `extractor/manifests.ts`). Used by every
 * architecture detector whose signals include packages.
 */

import { collectDependencies } from '../../manifests.js';
import type { CodebaseScan, DeclaredPackage, DetectionSignal } from '../types.js';

export function collectDeclaredPackages(rootDir: string): DeclaredPackage[] {
  return collectDependencies(rootDir).map((d) => ({
    name: d.name,
    version: d.version,
    field: d.field,
    source: { filePath: d.filePath, lineStart: 0, lineEnd: 0 },
  }));
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
