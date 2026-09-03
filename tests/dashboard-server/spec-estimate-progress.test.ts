/**
 * The dashboard keeps the estimate visible on `spec:progress`. Unlike the
 * terminal — where a leading estimate step made the in-place checklist paint
 * twice — the progress popup replaces in place, so the scan route opts INTO the
 * estimate as a checklist step via `estimateStepPhase(tracker)`.
 *
 * The curate engine is mocked (its own suite covers it); the subject is the
 * route → phase → socket-tracker wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';
import type { AnalysisProgressPayload } from '@truecourse/core/progress';

const { progress } = vi.hoisted(() => ({ progress: [] as AnalysisProgressPayload[] }));

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  const { StepTracker } = await import('@truecourse/core/progress');
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    // A real StepTracker (the socket one, minus the socket) so what the room
    // would receive is exactly what lands in `progress`. Copied per frame — the
    // socket serializes each payload, the array here would otherwise alias the
    // tracker's live step objects.
    createSocketSpecTracker: (_repoId: string, stepDefs: { key: string; label: string }[]) =>
      new StepTracker(
        (payload) => progress.push({ ...payload, steps: payload.steps?.map((s) => ({ ...s })) }),
        stepDefs,
      ),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
  };
});

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: vi.fn(async (_root: string, opts: Record<string, never>) => {
      const o = opts as unknown as {
        onEstimatePhase?: { start(): void; done(subject?: string): void };
        onLlmEstimate?: (e: unknown) => Promise<boolean>;
        tracker?: { start(k: string): void; done(k: string, d?: string): void };
      };
      o.onEstimatePhase?.start();
      o.onEstimatePhase?.done('2 docs');
      await o.onLlmEstimate?.({ totalEstimatedTokens: 1, tiers: [], stages: [] });
      o.tracker?.start('discover');
      o.tracker?.done('discover', '2/2 docs');
      return { noChanges: false, curate: { corpus: { areas: [] }, decisions: {}, stats: { areaCount: 0 } } };
    }),
  };
});

import { createTestApp } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

describe('spec scan route — estimate progress', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    execSync('git init -q', { cwd: fixture.repoPath });
    app = createTestApp();
    progress.length = 0;
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('streams the estimate as the leading checklist step, ahead of the run steps', async () => {
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus/scan`);
    expect(res.status).toBe(200);

    // Active while estimating, then done carrying the estimate's subject.
    const estimateStates = progress
      .map((p) => p.steps?.find((s) => s.key === 'estimate'))
      .filter((s): s is NonNullable<typeof s> => !!s);
    expect(estimateStates[0]).toMatchObject({ label: 'Estimating cost' });
    expect(estimateStates.some((s) => s.status === 'active')).toBe(true);
    expect(estimateStates.at(-1)).toMatchObject({ status: 'done', detail: '2 docs' });

    // …and it leads the checklist, before the curate steps it precedes.
    const final = progress.at(-1)!.steps!;
    expect(final[0].key).toBe('estimate');
    expect(final[1].key).toBe('discover');
    // The estimate was resolved before the first run step went active.
    const firstDiscoverActive = progress.findIndex(
      (p) => p.steps?.find((s) => s.key === 'discover')?.status === 'active',
    );
    expect(progress[firstDiscoverActive].steps!.find((s) => s.key === 'estimate')!.status).toBe('done');
  });
});
