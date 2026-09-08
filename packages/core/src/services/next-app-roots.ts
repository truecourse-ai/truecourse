import type { FileAnalysis } from '@truecourse/shared';
import { discoverNextAppRoots } from '@truecourse/shared/next-routing-node';

/** Read app manifests once each, bounded to the repository being mapped. */
export function nextAppRoots(repoRoot: string, analyses: readonly FileAnalysis[]): string[] {
  return discoverNextAppRoots(repoRoot, analyses.map((analysis) => analysis.filePath));
}
