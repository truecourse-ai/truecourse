/**
 * A stored run's SECTION SUMMARY, the history Home's trend is drawn from.
 *
 * Two halves are pinned here: the summary is written when a run is persisted,
 * and the boot sweep backfills the runs stored before summaries existed. The
 * third is the rule that keeps history honest. A run whose summary cannot be
 * derived is logged and left without one, never guessed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { manifestPath } from '@truecourse/guard-runner';
import { guardHistoryEntryOf, type GuardLatest } from '@truecourse/shared';
import {
  appendGuardHistory,
  readGuardRunSections,
  writeGuardRun,
} from '@truecourse/core/lib/guard-store';
import { log } from '@truecourse/core/lib/logger';
import { readRegistry, unregisterProject } from '@truecourse/core/config/registry';
import { persistGuardRun } from '../../apps/dashboard/server/src/jobs/materialize-guard';
import { backfillGuardRunSections } from '../../apps/dashboard/server/src/services/guard-sections.service';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

const DOC = 'context/site-docs-acme/refunds.md';
const BODY = '# Refunds\n\nA refund settles within two business days.\n\n# Timing\n\nWithin two days.\n';

let repo: TestFixture;

/** The scenario set: one flow bound to the Refunds section. */
function writeManifest(repoPath: string): void {
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
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
  repo = await setupTestFixture();
  fs.mkdirSync(path.join(repo.repoPath, path.dirname(DOC)), { recursive: true });
  fs.writeFileSync(path.join(repo.repoPath, DOC), BODY);
});

afterEach(async () => {
  await unregisterProject(repo.project.slug);
  await teardownTestFixture();
  vi.restoreAllMocks();
});

describe('a run’s section summary', () => {
  it('is written when the run is persisted', async () => {
    writeManifest(repo.repoPath);

    await persistGuardRun(
      { repoKey: repo.repoPath, commitSha: 'abcdef1234567890' },
      repo.repoPath,
      run('run-1', '2026-09-01T10:00:00.000Z'),
    );

    const [stored, ...rest] = await readGuardRunSections(repo.repoPath);
    expect(rest).toHaveLength(0);
    expect(stored).toMatchObject({ runId: 'run-1', ranAt: '2026-09-01T10:00:00.000Z' });
    // Both sections of the document the scenario set covers, in the five words:
    // the one the run failed, and the one nothing accounts for.
    expect(stored!.sections).toEqual({
      [`${DOC}#refunds`]: 'failed',
      [`${DOC}#timing`]: 'blocked',
    });
  });

  it('is backfilled onto a run stored without one', async () => {
    writeManifest(repo.repoPath);
    const latest = run('run-2', '2026-09-02T10:00:00.000Z');
    await writeGuardRun(repo.repoPath, latest);
    await appendGuardHistory(repo.repoPath, guardHistoryEntryOf(latest));
    expect(await readGuardRunSections(repo.repoPath)).toEqual([]);

    const outcome = await backfillGuardRunSections();

    expect(outcome).toMatchObject({ missing: 1, written: 1, skipped: 0 });
    const [stored] = await readGuardRunSections(repo.repoPath);
    expect(stored!.runId).toBe('run-2');
    expect(stored!.sections[`${DOC}#refunds`]).toBe('failed');
  });

  it('leaves a run whose summary cannot be derived without one, and says so', async () => {
    // No scenario set, and the document the run names is not readable: there is
    // nothing to derive a section from.
    fs.rmSync(path.join(repo.repoPath, DOC));
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const latest = run('run-3', '2026-09-03T10:00:00.000Z');
    await writeGuardRun(repo.repoPath, latest);
    await appendGuardHistory(repo.repoPath, guardHistoryEntryOf(latest));

    const outcome = await backfillGuardRunSections();

    expect(outcome).toMatchObject({ missing: 1, written: 0, skipped: 1 });
    expect(await readGuardRunSections(repo.repoPath)).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('run-3');
  });

  it('backfills nothing twice', async () => {
    writeManifest(repo.repoPath);
    const latest = run('run-4', '2026-09-04T10:00:00.000Z');
    await writeGuardRun(repo.repoPath, latest);
    await appendGuardHistory(repo.repoPath, guardHistoryEntryOf(latest));

    await backfillGuardRunSections();
    expect(await backfillGuardRunSections()).toMatchObject({ missing: 0, written: 0 });
  });
});
