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
  VerifyOverlapRunner,
} from '../../packages/spec-consolidator/src/index.js';

// Keep every doc; no LLM.
const relevance: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
const areaTagger: AreaTagRunner = async () => ({
  tags: [{ product: 'core', concern: 'orders' }],
  status: 'shipped',
});
const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });
const confirmAll: VerifyOverlapRunner = async () => ({ verdict: 'confirmed', reason: 'genuine' });

function decisionsWith(manualExcludes: string[]): DecisionsFile {
  return { version: 1, manualIncludes: [], manualExcludes, relations: [], manualAreas: [], conflictResolutions: [] };
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
    verifyOverlapRunner: confirmAll,
  });
}

describe('curateInProcess — decisions forwarding', () => {
  it('applies an injected force-exclude (not read from the tree)', async () => {
    // No decisions.json was written to `repo`, so beta.md drops from the corpus
    // only if the injected `decisions` reached curate().
    const { curate } = await run(decisionsWith(['docs/beta.md']));
    expect(curate.corpus.docs.map((d) => d.ref)).toEqual(['docs/alpha.md']);
  });

  it('keeps both docs when nothing is excluded', async () => {
    const { curate } = await run(decisionsWith([]));
    expect(curate.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/alpha.md', 'docs/beta.md']);
  });
});
