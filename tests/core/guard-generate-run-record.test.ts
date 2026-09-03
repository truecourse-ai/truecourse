/**
 * `guard generate` leaves a RUN RECORD, like the scan and setup do: one
 * `sessions/guard-generate/<runId>/run.json` carrying the step checklist, what
 * the run ran on and how it ended. Generate spends one-shot calls rather than
 * sessions, so the record is the only thing a surface that never saw the
 * process can read — and a hosted run keys it by repo identity, not by the
 * throwaway clone it ran in.
 *
 * Nothing here reaches a model: a repo with no corpus ends `no-docs` before the
 * first call, and a pre-aborted signal ends before the first step.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LlmTransport } from '@truecourse/shared/llm';
import {
  guardGenerateInProcess,
  EstimateDeclined,
  GuardGenerateAborted,
  GUARD_GENERATE_STEPS,
  OpenConflictsError,
} from '../../packages/core/src/commands/guard-in-process.js';
import { listSessionRuns } from '../../packages/core/src/lib/sessions-store.js';
import { resetSpecStore } from '../../packages/core/src/lib/spec-store.js';
import { StepTracker } from '../../packages/core/src/progress.js';

let repo: string;
let sessionsKey: string;

const transport = (async () => '{}') as LlmTransport;

beforeEach(() => {
  resetSpecStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-run-record-'));
  sessionsKey = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-run-key-'));
  fs.mkdirSync(path.join(repo, '.truecourse'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(sessionsKey, { recursive: true, force: true });
});

describe('guard generate run record', () => {
  it('records a failed run under the sessions key, with the checklist and the reason', async () => {
    const tracker = new StepTracker(() => {}, GUARD_GENERATE_STEPS.map((s) => ({ ...s })));
    const { guard } = await guardGenerateInProcess(repo, {
      tracker,
      transport,
      transportMode: 'api',
      attribution: { provider: 'anthropic', model: 'claude-workspace' },
      sessionsKey,
    });
    expect(guard.status).toBe('no-docs');

    // Keyed by the identity, not the tree the run happened in.
    expect(listSessionRuns(repo, 'guard-generate')).toHaveLength(0);
    const [run] = listSessionRuns(sessionsKey, 'guard-generate');
    expect(run).toMatchObject({
      command: 'guard-generate',
      status: 'failed',
      llm: { mode: 'api', provider: 'anthropic', model: 'claude-workspace' },
      error: { kind: 'no-docs', message: expect.stringContaining('No corpus found') },
      sessions: [],
    });
    expect(run.finishedAt).toBeDefined();
    // The checklist mirrors the tracker: the step it died in errored, the rest pending.
    const checklist = run.display?.blocks.find((b) => b.kind === 'checklist') as
      | { items: { key: string; status: string; sessionKinds?: string[] }[] }
      | undefined;
    expect(checklist?.items.map((i) => i.key)).toEqual(GUARD_GENERATE_STEPS.map((s) => s.key));
    expect(checklist?.items[0]).toMatchObject({ key: 'index', status: 'error' });
    expect(checklist?.items.slice(1).every((i) => i.status === 'pending')).toBe(true);
    // Each step claims the session kinds that do its work, so a surface reading
    // run.json files every session under its step instead of after the list.
    expect(checklist?.items.map((i) => [i.key, i.sessionKinds])).toEqual([
      ['index', []],
      ['extract', ['guard-generate.extract']],
      ['interfaces', []],
      ['flows', ['guard-generate.flows']],
      ['match', []],
      ['author', ['guard-generate.flow-worker', 'guard-generate.fidelity']],
      ['validate', []],
    ]);
  });

  it('defaults the record to the working tree, and names the saved provider', async () => {
    await guardGenerateInProcess(repo, { transport, transportMode: 'claude-code' });
    const [run] = listSessionRuns(repo, 'guard-generate');
    expect(run).toMatchObject({ status: 'failed', llm: { mode: 'claude-code', provider: 'claude-code' } });
    expect(run.llm?.model).toBeTruthy();
  });

  it('ends interrupted, before any step, when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      guardGenerateInProcess(repo, { transport, transportMode: 'api', signal: controller.signal, sessionsKey }),
    ).rejects.toBeInstanceOf(GuardGenerateAborted);
    const [run] = listSessionRuns(sessionsKey, 'guard-generate');
    expect(run).toMatchObject({ status: 'interrupted' });
    expect(run.error).toBeUndefined();
  });
});

describe('a generate the gates stop is on record too', () => {
  it('records a blocked corpus as a failed run carrying the conflict reason', async () => {
    fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'specs', 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['users'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['users'] },
        ],
        areas: [
          {
            id: 'users',
            product: 'users',
            concern: 'users',
            docRefs: ['docs/v1.md', 'docs/v2.md'],
            overlaps: [{ docs: ['docs/v1.md', 'docs/v2.md'], note: 'two names for one thing', sections: [] }],
          },
        ],
        relations: [],
        skippedDocs: [],
      }),
    );

    await expect(
      guardGenerateInProcess(repo, { transport, transportMode: 'api', sessionsKey }),
    ).rejects.toBeInstanceOf(OpenConflictsError);

    const [run] = listSessionRuns(sessionsKey, 'guard-generate');
    expect(run).toMatchObject({
      status: 'failed',
      error: { kind: 'open-conflicts', message: expect.stringContaining('1 open spec conflict') },
    });
  });

  it('records a declined estimate as interrupted', async () => {
    // A corpus with one changed section, so the estimate has something to
    // price and the gate actually asks.
    fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'cli.md'), '## version\n`app --version` prints the version.\n');
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'specs', 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [{ ref: 'docs/cli.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['cli'] }],
        areas: [{ id: 'cli', product: 'cli', concern: 'cli', docRefs: ['docs/cli.md'], overlaps: [] }],
        relations: [],
        skippedDocs: [],
      }),
    );

    await expect(
      guardGenerateInProcess(repo, {
        transport,
        transportMode: 'api',
        sessionsKey,
        onLlmEstimate: async () => false,
      }),
    ).rejects.toBeInstanceOf(EstimateDeclined);

    const [run] = listSessionRuns(sessionsKey, 'guard-generate');
    expect(run).toMatchObject({ status: 'interrupted' });
    expect(run.error).toBeUndefined();
  });
});
