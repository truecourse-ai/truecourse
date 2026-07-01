/**
 * curateInProcess must forward an injected `decisions` file to curate() instead
 * of only reading `.truecourse/specs/decisions.json` from the tree. EE relies on
 * this: its re-scan runs on a fresh clone with no decisions file (resolutions
 * live in Postgres), so it loads them and passes them in — otherwise already
 * resolved conflicts get re-detected on every re-scan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process';
import type {
  AreaTagRunner,
  DecisionsFile,
  OverlapRunner,
  RelevanceRunner,
} from '../../packages/spec-consolidator/src/index.js';

// Keep every doc; no LLM.
const relevance: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
// Both docs land in the same area so a relation between them is meaningful.
const areaTagger: AreaTagRunner = async () => ({
  tags: [{ product: 'core', concern: 'orders' }],
  status: 'shipped',
});
const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

// Non-versioned names so the deterministic filename chain detector adds nothing —
// any relation in the result therefore came from the injected decisions.
const USER_RELATION = {
  type: 'precedence' as const,
  older: 'docs/alpha.md',
  newer: 'docs/beta.md',
  scope: 'core/orders',
  detectedFrom: 'manual' as const,
};

function decisionsWith(relations: DecisionsFile['relations']): DecisionsFile {
  return { version: 1, decisions: [], manualChains: [], manualIncludes: [], relations, manualAreas: [] };
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-curate-inproc-'));
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'alpha.md'), '# Orders alpha\nCancel up to 24h before.');
  fs.writeFileSync(path.join(repo, 'docs', 'beta.md'), '# Orders beta\nCancel up to 48h before.');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function run(decisions: DecisionsFile) {
  return curateInProcess(repo, {
    skipGit: true,
    skipCorpusWrite: true,
    decisions,
    relevanceRunner: relevance,
    areaTagRunner: areaTagger,
    overlapRunner: flagAll,
    disableLlmRelationDetection: true,
  });
}

describe('curateInProcess — decisions forwarding', () => {
  it('folds an injected user relation into the corpus (not read from the tree)', async () => {
    // No decisions.json was written to `repo`, so the relation can only appear if
    // the injected `decisions` reached curate().
    const { curate } = await run(decisionsWith([USER_RELATION]));
    expect(curate.relations).toContainEqual(expect.objectContaining(USER_RELATION));
  });

  it('has no user relation when none is injected', async () => {
    const { curate } = await run(decisionsWith([]));
    expect(curate.relations).toEqual([]);
  });
});
