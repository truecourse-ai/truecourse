/**
 * curateInProcess must forward an injected `decisions` file to the scan run
 * instead of only reading `.truecourse/specs/decisions.json` from the tree. EE
 * relies on this: its re-scan runs on a fresh clone with no decisions file
 * (resolutions live in Postgres), so it loads them and passes them in —
 * otherwise already resolved conflicts get re-detected on every re-scan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process';
import type { DecisionsFile } from '../../packages/spec-consolidator/src/index.js';
import { outcome, stubDriver, toolResult } from './spec-scan-session-stub';

/** Keep every doc in one area; no provider, no network. */
const driver = () =>
  stubDriver(async (call) => {
    if (call.kind === 'spec-scan.settle-areas') {
      await call.emit(toolResult('check_settlement', 'valid'));
      return outcome({ concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] });
    }
    if (call.kind === 'spec-scan.overlap') {
      await call.emit(toolResult('check_findings', 'valid'));
      return outcome({ overlaps: [], notReached: [] });
    }
    return outcome({
      keep: true,
      reason: 'spec',
      subject: 'this-product',
      areas: [{ product: 'core', concern: 'orders' }],
      status: 'shipped',
    });
  }).driver;

function decisionsWith(manualExcludes: string[]): DecisionsFile {
  return {
    version: 2,
    manualIncludes: [],
    manualExcludes,
    manualAreas: [],
    conflictResolutions: [],
    instructions: [],
    // Covering verdicts: the scope orchestrator is not this file's subject.
    scopeVerdicts: ['.', 'docs'].map((p) => ({
      path: p,
      verdict: 'keep' as const,
      reason: 'covered by the test',
      decidedAt: '2026-01-01T00:00:00.000Z',
      resolvedBy: 'user' as const,
    })),
  };
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
  resetKvCacheStore();
  fs.rmSync(repo, { recursive: true, force: true });
});

function run(decisions: DecisionsFile) {
  return curateInProcess(repo, {
    skipGit: true,
    skipCorpusWrite: true,
    decisions,
    driver: driver(),
  });
}

describe('curateInProcess — decisions forwarding', () => {
  it('applies an injected force-exclude (not read from the tree)', async () => {
    // No decisions.json was written to `repo`, so beta.md drops from the corpus
    // only if the injected `decisions` reached the run.
    const { curate } = await run(decisionsWith(['docs/beta.md']));
    expect(curate.corpus.docs.map((d) => d.ref)).toEqual(['docs/alpha.md']);
  });

  it('keeps both docs when nothing is excluded', async () => {
    const { curate } = await run(decisionsWith([]));
    expect(curate.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/alpha.md', 'docs/beta.md']);
  });
});
