/**
 * Put the stored spec back into a work tree.
 *
 * A hosted run works in an ephemeral clone that carries no `.truecourse/`, but
 * everything downstream of the scan reads the curated corpus (and the
 * resolutions folded into it) as FILES: guard setup's doc universe, the
 * generator's section plan, the conflict gate. So a job that runs after the
 * scan materializes what the scan persisted — the corpus for the tree's commit
 * when there is one, else the repo's newest, since the corpus is keyed by the
 * SCAN-TIME commit and the clone may sit past it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { corpusFilePath, decisionsPath, type DecisionsFile } from '@truecourse/spec-consolidator';
import { loadLatestSpec, loadSpec } from '@truecourse/core/lib/spec-store';
import type { RepoRef } from '@truecourse/core/lib/contract-store';

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Write the stored corpus (and decisions, when the repo has any) into
 * `treeDir`. Returns false when the repo has no stored corpus at all — the
 * caller decides what "never scanned" means for it.
 */
export async function materializeStoredSpec(ref: RepoRef, treeDir: string): Promise<boolean> {
  const corpus = (await loadSpec(ref, 'corpus')) ?? (await loadLatestSpec(ref.repoKey, 'corpus'));
  if (corpus == null) return false;
  writeJson(corpusFilePath(treeDir), corpus);

  // The resolutions travel with the corpus they resolve: without them a
  // conflict the user already settled reads as open again in this clone.
  const decisions =
    (await loadSpec<DecisionsFile>(ref, 'decisions')) ??
    (await loadLatestSpec<DecisionsFile>(ref.repoKey, 'decisions'));
  if (decisions != null) writeJson(decisionsPath(treeDir), decisions);
  return true;
}
