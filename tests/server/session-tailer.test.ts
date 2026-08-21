import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireRunTail,
  acquireRunsWatch,
  releaseRunTail,
  releaseRunsWatch,
  stopAllRunTails,
  type RunTailTarget,
} from '../../apps/dashboard/server/src/services/session-tailer.service';
import type { SessionEvent } from '../../packages/agent-loop/src/index';

/**
 * The transcript tailer: appended jsonl lines come out as parsed events, a
 * trailing partial line waits for its completion, and a run.json rewrite
 * surfaces the (redacted) record.
 */

const EVENT = (seq: number): string =>
  JSON.stringify({ seq, ts: `2026-08-21T00:00:0${seq}.000Z`, type: 'user-message', content: `m${seq}` });

describe('session tailer', () => {
  let tmp: string | null = null;

  afterEach(() => {
    stopAllRunTails();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  const setup = () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-tail-'));
    const target: RunTailTarget = { repoPath: tmp, command: 'spec-scan', runId: 'run-1' };
    const dir = path.join(tmp, '.truecourse', 'sessions', 'spec-scan', 'run-1');
    fs.mkdirSync(dir, { recursive: true });
    return { target, dir };
  };

  it('emits appended events, holding back a partial trailing line', async () => {
    const { target, dir } = setup();
    const file = path.join(dir, 'ses-1.jsonl');
    // Content present BEFORE the tail starts belongs to the snapshot, not the tail.
    fs.writeFileSync(file, EVENT(0) + '\n');

    const events: Array<{ sessionId: string; event: SessionEvent }> = [];
    const runs: unknown[] = [];
    acquireRunTail(target, {
      onEvent: (sessionId, event) => events.push({ sessionId, event }),
      onRunUpdated: (run) => runs.push(run),
    });
    // chokidar needs a beat to install its watcher before the first append.
    await new Promise((r) => setTimeout(r, 300));

    fs.appendFileSync(file, EVENT(1) + '\n' + EVENT(2).slice(0, 10));
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 5000 });
    expect(events[0].sessionId).toBe('ses-1');
    expect(events[0].event.seq).toBe(1);

    // Completing the partial line releases it whole.
    fs.appendFileSync(file, EVENT(2).slice(10) + '\n');
    await vi.waitFor(() => expect(events).toHaveLength(2), { timeout: 5000 });
    expect(events[1].event.seq).toBe(2);
    expect(runs).toHaveLength(0);
  });

  it('surfaces run.json rewrites as redacted records, and stops on release', async () => {
    const { target, dir } = setup();
    const record = {
      command: 'spec-scan',
      runId: 'run-1',
      gitRef: 'abc',
      startedAt: '2026-08-21T00:00:00.000Z',
      status: 'running',
      pid: process.pid,
      endpoint: { url: 'http://127.0.0.1:1', token: 'SECRET' },
      sessions: [],
    };

    const runs: Array<Record<string, unknown>> = [];
    acquireRunTail(target, {
      onEvent: () => {},
      onRunUpdated: (run) => runs.push(run as unknown as Record<string, unknown>),
    });
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(record));
    await vi.waitFor(() => expect(runs).toHaveLength(1), { timeout: 5000 });
    expect(runs[0].runId).toBe('run-1');
    expect(runs[0].endpoint).toBeUndefined();
    expect(runs[0].pid).toBeUndefined();

    releaseRunTail(target);
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...record, status: 'completed' }));
    await new Promise((r) => setTimeout(r, 500));
    expect(runs).toHaveLength(1);
  });

  it('fires the runs-list watch when a run.json appears anywhere in the store', async () => {
    const { target } = setup();
    let changes = 0;
    acquireRunsWatch(target.repoPath, () => changes++);
    await new Promise((r) => setTimeout(r, 300));

    // A brand-new run directory (the CLI just started a scan).
    const newDir = path.join(target.repoPath, '.truecourse', 'sessions', 'spec-scan', 'run-2');
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'run.json'), JSON.stringify({ runId: 'run-2' }));
    await vi.waitFor(() => expect(changes).toBeGreaterThan(0), { timeout: 5000 });

    // Transcript appends are NOT runs-list changes.
    const before = changes;
    fs.writeFileSync(path.join(newDir, 'ses-1.jsonl'), EVENT(0) + '\n');
    await new Promise((r) => setTimeout(r, 500));
    expect(changes).toBe(before);

    releaseRunsWatch(target.repoPath);
    fs.writeFileSync(path.join(newDir, 'run.json'), JSON.stringify({ runId: 'run-2', status: 'completed' }));
    await new Promise((r) => setTimeout(r, 500));
    expect(changes).toBe(before);
  });
});
