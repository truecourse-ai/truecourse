import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  guardGenerateInProcess, GUARD_GENERATE_STEPS, GuardGenerateResumeError,
} from '../../packages/core/src/commands/guard-in-process.js';
import { StepTracker } from '../../packages/core/src/progress.js';
import { resetSpecStore } from '../../packages/core/src/lib/spec-store.js';
import { flowStageSeams, makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js';
import { stubDriver } from './spec-scan-session-stub.js';

let repo: string;
beforeEach(() => {
  resetSpecStore();
  repo = makeTempRepo();
  writeRecipe(repo);
  writeCorpus(repo, [{ ref: 'docs/cli.md' }]);
  writeDoc(repo, 'docs/cli.md', '## version\n`relkit --version` prints the version and exits 0.\n');
});
afterEach(() => rmrf(repo));

describe('resume through the generate driver', () => {
  it('refuses a completed matcher cache miss before spending or starting workers', async () => {
    const transport = vi.fn(async () => '{}');
    const workers = vi.fn(async () => { throw new Error('workers must not start after failed replay'); });
    const active: string[] = [];
    const tracker = new StepTracker(progress => {
      active.push(...(progress.steps ?? []).filter(step => step.status === 'active').map(step => step.key));
    }, GUARD_GENERATE_STEPS.map(step => ({ ...step })));

    await expect(guardGenerateInProcess(repo, {
      ...flowStageSeams(repo),
      matchRunner: undefined,
      flowWorkerSession: workers,
      transport,
      tracker,
      requireExistingRecipe: true,
      resume: { runId: 'old-run', gitRef: '', completedSteps: ['index', 'extract', 'interfaces', 'flows', 'match'] },
    })).rejects.toBeInstanceOf(GuardGenerateResumeError);

    expect(transport).not.toHaveBeenCalled();
    expect(workers).not.toHaveBeenCalled();
    expect(active).toEqual([]);
  });

  it('reports a missing completed extraction result without constructing a session driver', async () => {
    const { driver, calls } = stubDriver(() => { throw new Error('completed extraction must not run'); });
    await expect(guardGenerateInProcess(repo, {
      ...flowStageSeams(repo),
      extractSession: undefined,
      driver,
      transport: async () => '{}',
      resume: { runId: 'old-run', gitRef: '', completedSteps: ['index', 'extract'] },
    })).rejects.toThrow('Cannot resume: saved extract results are missing');
    expect(calls).toEqual([]);
  });
});
