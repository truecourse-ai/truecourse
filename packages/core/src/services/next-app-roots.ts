import fs from 'node:fs';
import path from 'node:path';
import type { FileAnalysis } from '@truecourse/shared';

/** Read app manifests once each, bounded to the repository being mapped. */
export function nextAppRoots(repoRoot: string, analyses: readonly FileAnalysis[]): string[] {
  const root = path.resolve(repoRoot);
  const visited = new Set<string>();
  const roots: string[] = [];
  for (const analysis of analyses) {
    let directory = path.dirname(path.resolve(root, analysis.filePath));
    while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
      if (visited.has(directory)) break;
      visited.add(directory);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        if (typeof manifest?.dependencies?.next === 'string'
          || typeof manifest?.devDependencies?.next === 'string') {
          roots.push(directory);
        }
      } catch {
        // An absent or invalid manifest provides no framework evidence.
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  return roots.sort();
}
