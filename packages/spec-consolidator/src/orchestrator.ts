/**
 * Decisions-file persistence for the spec-consolidator.
 *
 * `decisions.json` holds the user-authored curation intent the corpus
 * path reads: `manualAreas[]` (area-tag overrides), `manualIncludes[]` /
 * `manualExcludes[]` (relevance overrides), and `conflictResolutions[]`.
 * Both the CLI (`spec` subcommands) and the dashboard server write through
 * these helpers, and `curate()` reads them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DecisionsFileSchema, type DecisionsFile } from './types.js';

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
};

export function decisionsPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', 'decisions.json');
}

export function specRootPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs');
}

/**
 * Read `decisions.json` from the repo's `.truecourse/specs/` dir.
 * Returns an empty decisions file if missing or unparseable —
 * stale/corrupt files shouldn't block a scan run.
 */
export function readDecisions(repoRoot: string): DecisionsFile {
  const file = decisionsPath(repoRoot);
  if (!fs.existsSync(file)) return EMPTY_DECISIONS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return DecisionsFileSchema.parse(raw);
  } catch {
    return EMPTY_DECISIONS;
  }
}

/**
 * Write `decisions.json`. Used by the CLI's `spec` relation flow, the dashboard
 * write-back endpoints, and `curate()`'s orphan prune.
 *
 * Atomic (write-to-tmp + rename), the store convention: a scan prunes this file
 * in the same cycle it writes `corpus.json`, and a reader must never observe a
 * half-written decisions file. The tmp+rename is inlined rather than imported so
 * the consolidator stays free of a `@truecourse/core` dependency.
 */
export function writeDecisions(repoRoot: string, decisions: DecisionsFile): void {
  const file = decisionsPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(decisions, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
