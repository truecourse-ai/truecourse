/**
 * Decisions-file persistence for the spec-consolidator.
 *
 * `decisions.json` holds the user-authored curation intent the corpus
 * path reads: doc→doc `relations[]`, `manualAreas[]` (area-tag
 * overrides), and `manualIncludes[]` (relevance force-includes). Both
 * the CLI (`spec` subcommands) and the dashboard server write through
 * these helpers, and `curate()` reads them to apply effective relations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DecisionsFileSchema, type DecisionsFile } from './types.js';

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  relations: [],
  manualAreas: [],
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
 * Write `decisions.json`. Used by the CLI's `spec` relation flow and
 * the dashboard write-back endpoints.
 */
export function writeDecisions(repoRoot: string, decisions: DecisionsFile): void {
  const file = decisionsPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(decisions, null, 2) + '\n');
}
