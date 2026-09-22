/**
 * A stored run's COVERAGE SUMMARIES, the history Home is drawn from: its
 * SECTIONS, which the changes widget follows, and its FLOWS, which the trend
 * counts.
 *
 * Three things are pinned here: both summaries are written when a run is
 * persisted, and the two rules that keep history honest. A run whose section
 * summary cannot be derived is logged and left out of history entirely; one
 * whose FLOW summary cannot be derived is still recorded, and is simply not a
 * point of the flow trend. Neither is ever guessed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { manifestPath } from '@truecourse/guard-runner';
import type { GuardLatest } from '@truecourse/shared';
import { readGuardRunCoverage } from '@truecourse/core/lib/guard-store';
import { readGuardRunFlowSummaryFromTree } from '@truecourse/core/commands/guard-read';
import { log } from '@truecourse/core/lib/logger';
import { clearTestRegistry } from '../helpers/test-fixture';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { installWorkTreeDocReader, resetRepoDocReader } from '../helpers/work-tree-doc-reader';
import { persistGuardRun } from '../../apps/dashboard/server/src/jobs/materialize-guard';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';

const DOC = 'context/site-docs-acme/refunds.md';
const BODY = '# Refunds\n\nA refund settles within two business days.\n\n# Timing\n\nWithin two days.\n';

let repo: TestFixture;

/** The scenario set: one flow bound to the Refunds section, plus any extra entries. */
function writeManifest(repoPath: string, extraFlows: object[] = []): void {
  fs.mkdirSync(path.dirname(manifestPath(repoPath)), { recursive: true });
  fs.writeFileSync(
    manifestPath(repoPath),
    JSON.stringify({
      flows: [
        {
          flowId: 'f1',
          flowFingerprint: 'sha256:f',
          bindings: [{ doc: DOC, anchor: 'refunds', fingerprint: 'sha256:x' }],
          scenarios: [{ id: 's1', drivers: ['cli'] }],
          interfaces: [],
          generationInputsHash: null,
          gaps: [],
          retiredScenarios: [],
        },
        ...extraFlows,
      ],
    }),
  );
}

function run(runId: string, ranAt: string): GuardLatest {
  return {
    run: {
      runId,
      ranAt,
      branch: 'main',
      commit: 'abcdef1234567890',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0 },
    scenarios: [
      {
        id: 's1',
        title: 'a refund settles',
        binds: { doc: DOC, section: 'refunds', fingerprint: 'sha256:x' },
        outcome: 'fail',
        durationMs: 1,
      },
    ],
    sections: [],
  } as GuardLatest;
}

beforeEach(async () => {
  installWorkTreeGuardStore();
  installMemoryGuardOverlays();
  installWorkTreeDocReader();
  clearTestRegistry();
  repo = await setupTestFixture();
  fs.mkdirSync(path.join(repo.repoPath, path.dirname(DOC)), { recursive: true });
  fs.writeFileSync(path.join(repo.repoPath, DOC), BODY);
});

afterEach(async () => {
  clearTestRegistry();
  resetGuardStore();
  resetGuardOverlayStore();
  resetRepoDocReader();
  await teardownTestFixture();
  vi.restoreAllMocks();
});

describe('a run’s coverage summaries', () => {
  it('are written when the run is persisted', async () => {
    writeManifest(repo.repoPath);

    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-1', '2026-09-01T10:00:00.000Z'),
    );

    const [stored, ...rest] = await readGuardRunCoverage(repo.repoPath);
    expect(rest).toHaveLength(0);
    expect(stored).toMatchObject({ runId: 'run-1', ranAt: '2026-09-01T10:00:00.000Z' });
    // Both sections of the document the scenario set covers, in the five words:
    // the one the run failed, and the one nothing accounts for.
    expect(stored!.sections).toEqual({
      [`${DOC}#refunds`]: 'failed',
      [`${DOC}#timing`]: 'blocked',
    });
    // The flow the failing scenario belongs to, in the Flows page's words.
    expect(stored!.flows).toEqual({ f1: 'failed' });
  });

  it('leaves a flow the corpus retired out of the flow summary — history, not coverage', async () => {
    // An entry the last generate marked orphaned: its scenario still runs and
    // shows on the Flows page under "not in specs", but it is no flow of the
    // repository any more, so the trend must not count it.
    writeManifest(repo.repoPath, [
      {
        flowId: 'retired-flow',
        flowFingerprint: 'sha256:old',
        bindings: [{ doc: DOC, anchor: 'timing', fingerprint: 'sha256:old' }],
        scenarios: [{ id: 's-old', drivers: ['cli'], status: 'passing' }],
        interfaces: [],
        generationInputsHash: null,
        gaps: [],
        retiredScenarios: [],
        orphaned: true,
        orphanedReason: 'the claims no longer describe a timing guarantee',
      },
    ]);

    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-2', '2026-09-02T10:00:00.000Z'),
    );

    const [stored] = await readGuardRunCoverage(repo.repoPath);
    expect(stored!.flows).toEqual({ f1: 'failed' });
  });

  it('derives the same flow summary from the working tree as from the store, retired flow included', async () => {
    writeManifest(repo.repoPath, [
      {
        flowId: 'retired-flow',
        flowFingerprint: 'sha256:old',
        bindings: [{ doc: DOC, anchor: 'timing', fingerprint: 'sha256:old' }],
        scenarios: [{ id: 's-old', drivers: ['cli'], status: 'passing' }],
        interfaces: [],
        generationInputsHash: null,
        gaps: [],
        retiredScenarios: [],
        orphaned: true,
        orphanedReason: 'retired',
      },
    ]);
    const latest = run('run-4', '2026-09-04T10:00:00.000Z');
    await persistGuardRun({ repoKey: repo.repoPath, commitSha: 'abcdef1234567890' }, repo.repoPath, latest);
    const [stored] = await readGuardRunCoverage(repo.repoPath);
    // The store here IS the working tree, so the two reads see one set.
    expect(readGuardRunFlowSummaryFromTree(repo.repoPath, latest)).toEqual(stored!.flows);
    expect(stored!.flows).toEqual({ f1: 'failed' });
  });

  it('records the coverage handed to it instead of deriving one', async () => {
    writeManifest(repo.repoPath);
    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-5', '2026-09-05T10:00:00.000Z'),
      { coverage: { sections: {}, flows: { f1: 'succeeded' } } },
    );
    const [stored] = await readGuardRunCoverage(repo.repoPath);
    expect(stored).toMatchObject({ runId: 'run-5', sections: {}, flows: { f1: 'succeeded' } });
  });

  it('gives a scenario that belongs to no flow its Manual pseudo-flow, as the Flows page does', async () => {
    // No manifest: the run's scenario belongs to no synthesized flow, and the
    // flow list shows it under a Manual pseudo-flow rather than not at all.
    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-3', '2026-09-03T10:00:00.000Z'),
    );

    const [stored] = await readGuardRunCoverage(repo.repoPath);
    expect(stored!.flows).toEqual({ 'manual:s1': 'failed' });
  });

  it('leaves a run whose sections cannot be derived without either, and says so', async () => {
    // No scenario set, and the document the run names is not readable: there is
    // nothing to derive a section from.
    fs.rmSync(path.join(repo.repoPath, DOC));
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});

    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-2', '2026-09-02T10:00:00.000Z'),
    );

    expect(await readGuardRunCoverage(repo.repoPath)).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('run-2');
  });
});
