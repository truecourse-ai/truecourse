import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUIMessageStream } from 'ai';
import { createSessionRun, openSessionRun, reconcileSessionsStore, recoverSessionActivity } from '@truecourse/core/lib/sessions-store';
import { readActivityEvents, readActivityProgress, subscribeActivity } from '@truecourse/core/lib/activity-journal';
import { createActivityStream } from '../../apps/dashboard/server/src/services/activity-stream.service';
import { dashboardActivity } from '../../apps/dashboard/server/src/services/dashboard-activity.service';
import { JobStepTracker, type JobContext } from '@truecourse/jobs';
import type { OnboardingJobPayload } from '../../apps/dashboard/server/src/jobs/tasks/onboarding';
import { KnownDisplayBlockSchema } from '../../packages/agent-loop/src/index';
import type { SessionEvent } from '@truecourse/agent-loop';

const event = (seq = 0): SessionEvent => ({ type: 'user-message', seq, ts: new Date().toISOString(), content: `Read café ${seq}` });

describe('dashboard activity journal and stream', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-activity-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const create = () => createSessionRun(root, { command: 'spec-scan', gitRef: 'abc', activityStream: true });

  it('delivers local updates without replay and catches up periodically and on remote notification', async () => {
    vi.useFakeTimers();
    const run = create();
    const history = readActivityEvents(run.dir);
    run.readActivity = vi.fn(async after => history.filter(e => e.cursor > after));
    let remote: (() => void) | undefined;
    run.subscribeActivity = notify => { remote = notify; return () => { remote = undefined; }; };
    const controller = new AbortController();
    const reader = createActivityStream(run, -1, controller.signal).getReader();
    const chunks: import('ai').UIMessageChunk[] = [];
    const consume = (async () => {
      for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
    })();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(run.readActivity).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(4000);
        run.persistence.publishProgress!('s', { kind: 'text', turnId: 't', text: `partial ${i}` });
        await vi.advanceTimersByTimeAsync(0);
      }
      run.persistence.appendEvent('s', event());
      await vi.advanceTimersByTimeAsync(0);
      expect(run.readActivity).toHaveBeenCalledTimes(1);
      expect(chunks.filter(c => c.type === 'data-activity')).toHaveLength(2);
      expect(chunks.some(c => c.type === 'data-progress' && JSON.stringify(c.data).includes('partial 2'))).toBe(true);

      // Local wakeups must neither trigger nor postpone the 15-second catch-up.
      history.push({ cursor: 10000, kind: 'session-event', sessionId: 'remote', event: event(1) });
      await vi.advanceTimersByTimeAsync(3000);
      expect(run.readActivity).toHaveBeenCalledTimes(2);
      expect(chunks.filter(c => c.type === 'data-activity')).toHaveLength(3);
      expect(chunks.some(c => c.type === 'data-heartbeat')).toBe(true);

      history.push({ cursor: 10001, kind: 'run', run: { ...run.record(), status: 'completed' } });
      remote!();
      await consume;
      expect(run.readActivity).toHaveBeenCalledTimes(3);
      expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
      expect(remote).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { controller.abort(); await consume; vi.useRealTimers(); }
  });

  it('publishes only persisted events, with independent session identities and byte cursors', () => {
    const run = create();
    let observed = 0;
    const unsubscribe = subscribeActivity(run.dir, () => { observed = readActivityEvents(run.dir).length; });
    run.persistence.appendEvent('a', event());
    run.persistence.appendEvent('b', event());
    expect(observed).toBe(3);
    const records = readActivityEvents(run.dir);
    expect(records.map(e => e.cursor)).toEqual([...records.map(e => e.cursor)].sort((a,b) => a-b));
    expect(readActivityEvents(run.dir, records[1].cursor)).toEqual([records[2]]);
    expect(readActivityEvents(run.dir, records[2].cursor)).toEqual([]);
    expect(() => readActivityEvents(run.dir, 2)).toThrow('boundary');
    expect(() => readActivityEvents(run.dir, 999999)).toThrow('beyond');
    unsubscribe();
  });

  it('publishes immutable run snapshots directly and keeps slow viewers lossless', async () => {
    const run = create();
    const published: import('@truecourse/shared/activity-stream').ActivityEvent[] = [];
    const unsubscribe = subscribeActivity(run.dir, event => { if (event) published.push(event); });
    run.persistence.updateIndex({ sessionId: 'a', kind: 'scan', workItem: 'doc', status: 'running', spent: { turns: 0, tokens: 0, costUsd: 0 } });
    const reader = createActivityStream(run, -1, new AbortController().signal).getReader();
    await reader.read();
    // Begin replay, then leave the viewer behind a burst that exceeds its live queue.
    await reader.read();
    for (let seq = 0; seq < 150; seq++) run.persistence.appendEvent('a', event(seq));
    run.persistence.updateIndex({ sessionId: 'a', kind: 'scan', workItem: 'doc', status: 'completed', spent: { turns: 1, tokens: 2, costUsd: 0 } });
    run.finish('completed');
    expect(published[0]).toMatchObject({ kind: 'run', run: { sessions: [{ status: 'running' }] } });
    const transcript = [];
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      if (next.value.type === 'data-activity' && (next.value.data as { kind: string }).kind === 'session-event') transcript.push(next.value.data);
    }
    expect(transcript).toHaveLength(150);
    unsubscribe();
  });

  it('keeps CLI storage unchanged and does not publish credentials', () => {
    const legacy = createSessionRun(root, { command: 'spec-scan', gitRef: 'abc' });
    legacy.persistence.appendEvent('a', event());
    expect(fs.existsSync(path.join(legacy.dir, 'activity.jsonl'))).toBe(false);
    expect(legacy.persistence.publishProgress).toBeUndefined();
    const run = create();
    run.setEndpoint({ url: 'http://localhost:1234', token: 'NEVER-PUBLIC' });
    const journal = fs.readFileSync(path.join(run.dir, 'activity.jsonl'), 'utf8');
    expect(journal).not.toContain('NEVER-PUBLIC');
    expect(journal).not.toContain('"pid"');
    expect(journal).not.toContain('"endpoint"');
  });

  it('repairs a crash between transcript persistence and journal append, including a partial tail', () => {
    const run = create();
    fs.appendFileSync(path.join(run.dir, 'a.jsonl'), JSON.stringify(event())+'\n');
    fs.appendFileSync(path.join(run.dir, 'activity.jsonl'), '{"cursor":');
    recoverSessionActivity(run);
    expect(readActivityEvents(run.dir).filter(e => e.kind === 'session-event')).toHaveLength(1);
    recoverSessionActivity(run);
    expect(readActivityEvents(run.dir).filter(e => e.kind === 'session-event')).toHaveLength(1);
    run.finish('completed');
    expect(readActivityEvents(run.dir).at(-1)).toMatchObject({ kind: 'run', run: { status: 'completed' } });
  });

  it('fails loudly for complete corrupt records', () => {
    const run = create();
    fs.appendFileSync(path.join(run.dir, 'activity.jsonl'), 'corrupt\n');
    expect(() => readActivityEvents(run.dir)).toThrow();
  });

  it('replays a finished run as SDK data parts, even when no viewer saw it live', async () => {
    const run = create();
    run.persistence.appendEvent('a', event());
    run.finish('completed');
    const snapshots = [];
    for await (const message of readUIMessageStream({ stream: createActivityStream(run, -1, new AbortController().signal), terminateOnError: true })) snapshots.push(message);
    const last = snapshots.at(-1)!;
    expect(last.id).toBe(run.runId);
    expect(last.parts.filter(p => p.type === 'data-activity')).toHaveLength(3);
    expect(last.parts.some(p => p.type === 'data-progress' || p.type === 'data-heartbeat')).toBe(false);
  });

  it('catches events written while replay is being consumed and isolates viewer cancellation', async () => {
    const run = create();
    const first = createActivityStream(run, -1, new AbortController().signal).getReader();
    const second = createActivityStream(run, -1, new AbortController().signal).getReader();
    expect((await first.read()).value?.type).toBe('start');
    expect((await second.read()).value?.type).toBe('start');
    await first.cancel();
    expect(run.record().status).toBe('running');
    run.persistence.appendEvent('later', event());
    run.finish('completed');
    const chunks = [];
    for (;;) { const next = await second.read(); if (next.done) break; chunks.push(next.value); }
    expect(chunks.filter(c => c.type === 'data-activity')).toHaveLength(3);
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  });

  it('replays missed events from a cursor after reopening the run and records dead-process recovery', async () => {
    const run = create();
    const cursor = readActivityEvents(run.dir).at(-1)!.cursor;
    run.persistence.appendEvent('a', event());
    reconcileSessionsStore(root, { isProcessAlive: () => false });
    const reopened = openSessionRun(root, 'spec-scan', run.runId);
    expect(reopened.record().status).toBe('interrupted');
    const reader = createActivityStream(reopened, cursor, new AbortController().signal).getReader();
    const replay = [];
    for (;;) { const next = await reader.read(); if (next.done) break; if (next.value.type === 'data-activity') replay.push(next.value.data); }
    expect(replay).toHaveLength(2);
    expect(replay.at(-1)).toMatchObject({ kind: 'run', run: { status: 'interrupted' } });
  });

  it('keeps partial progress transient and removes it when the complete turn lands', () => {
    const run = create();
    const initial = readActivityEvents(run.dir).length;
    run.persistence.publishProgress!('a', { kind: 'text', turnId: 'turn-1', text: 'Reading…' });
    expect(readActivityProgress(run.dir).a).toMatchObject({ text: 'Reading…' });
    expect(readActivityEvents(run.dir)).toHaveLength(initial);
    expect(run.persistence.readEvents('a')).toEqual([]);
    run.persistence.appendEvent('a', { ...event(), type: 'assistant-turn', text: 'Read.', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' } });
    expect(readActivityProgress(run.dir)).toEqual({});
    run.finish('completed');
  });
});


it('does not lose a commit arriving while an asynchronous replay query is in flight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-activity-await-'));
  const run = createSessionRun(root, { command: 'guard-generate', gitRef: 'abc', activityStream: true });
  let resolveRead!: () => void;
  const gate = new Promise<void>(resolve => { resolveRead = resolve; });
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  let first = true;
  run.readActivity = async after => {
    const snapshot = readActivityEvents(run.dir, after);
    if (first) { first = false; reading(); await gate; }
    return snapshot;
  };
  const reader = createActivityStream(run, -1, new AbortController().signal).getReader();
  await reader.read();
  const pending = reader.read();
  await started;
  run.persistence.appendEvent('s', event());
  run.finish('completed');
  resolveRead();
  const chunks = [(await pending).value];
  for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
  expect(chunks.filter(c => c?.type === 'data-activity')).toHaveLength(3);
  expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  fs.rmSync(root, { recursive: true, force: true });
});

// The hosted job's tracker is the only route a phase's own words have to the
// stored run: whatever the engine said it did must survive the mirror.
it('mirrors a step fact onto the run record checklist, beside its counter', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-activity-facts-'));
  const ctx: JobContext<OnboardingJobPayload> = {
    payload: {
      jobId: 'job-1',
      repoId: 'repo-1',
      repoFullName: root,
      workspaceOrgId: 'org-1',
      source: 'manual',
    },
    org: 'org-1',
    jobId: 'job-1',
    tracker: new JobStepTracker([{ key: 'scan', label: 'Scanning' }], () => {}),
    phase: async () => {},
    detail: async () => {},
  };

  let runId = '';
  await dashboardActivity(
    ctx,
    'spec-scan',
    [{ key: 'discover', label: 'Discovering docs' }],
    async (run, tracker) => {
      runId = run.runId;
      tracker.start('discover');
      tracker.detail('discover', '2 docs · 1 to curate');
      tracker.fact('discover', 'docs/a.md: kept, core/orders, from cache');
      tracker.fact('discover', 'docs/b.md: dropped before curation, not a spec');
      tracker.fact('nowhere', 'a fact for a step this checklist has not got');
      tracker.done('discover');
    },
  );

  const record = openSessionRun(root, 'spec-scan', runId).record();
  const block = KnownDisplayBlockSchema.parse(
    record.display?.blocks.find(b => b.kind === 'checklist'),
  );
  if (block.kind !== 'checklist') throw new Error('the run stamped no checklist block');
  const discover = block.items.find(item => item.key === 'discover');
  expect(discover?.detail).toBe('2 docs · 1 to curate');
  expect(discover?.facts).toEqual([
    'docs/a.md: kept, core/orders, from cache',
    'docs/b.md: dropped before curation, not a spec',
  ]);
  expect(block.items.find(item => item.key === 'clone')?.facts).toBeUndefined();
  fs.rmSync(root, { recursive: true, force: true });
});
