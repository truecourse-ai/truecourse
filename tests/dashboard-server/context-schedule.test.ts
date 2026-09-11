/**
 * The sweep that syncs what no event will: a documentation site older than a
 * day (nothing announces a change to one), and any source that has never
 * synced (its first sync was never run, or was lost). The queue's single-flight
 * key is what makes a duplicate enqueue harmless, so the sweep just asks —
 * on the timer, and once at boot, which the server asks for by hand.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DueContextSource } from '@truecourse/data-store';
import type { EnqueueResult } from '../../apps/dashboard/server/src/jobs/index';
import {
  CONTEXT_SITE_MAX_AGE_MS,
  startContextSyncSchedule,
} from '../../apps/dashboard/server/src/services/context-schedule.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');

interface Harness {
  asked: string[];
  enqueued: { workspaceOrgId: string; sourceId: string; source: string }[];
  schedule: ReturnType<typeof startContextSyncSchedule>;
}

function harness(
  due: DueContextSource[],
  answer: EnqueueResult = { status: 'queued', jobId: 'job_1' },
  over: { intervalMs?: number; maxAgeMs?: number } = {},
): Harness {
  const asked: string[] = [];
  const enqueued: Harness['enqueued'] = [];
  const schedule = startContextSyncSchedule(null, {
    due: async (before) => {
      asked.push(before);
      return due;
    },
    enqueue: async (request) => {
      enqueued.push(request);
      return answer;
    },
    now: () => NOW,
    ...over,
  });
  return { asked, enqueued, schedule };
}

describe('the sweep', () => {
  it('asks for what is older than a day', async () => {
    const h = harness([]);
    await h.schedule.sweep();
    h.schedule.stop();
    expect(h.asked).toEqual([new Date(NOW.getTime() - CONTEXT_SITE_MAX_AGE_MS).toISOString()]);
  });

  it('enqueues one sync per due source, across workspaces', async () => {
    const h = harness([
      { workspaceOrgId: 'org_A', sourceId: 'site-a' },
      { workspaceOrgId: 'org_B', sourceId: 'site-b' },
    ]);
    expect(await h.schedule.sweep()).toBe(2);
    h.schedule.stop();
    expect(h.enqueued).toEqual([
      { workspaceOrgId: 'org_A', sourceId: 'site-a', source: 'schedule' },
      { workspaceOrgId: 'org_B', sourceId: 'site-b', source: 'schedule' },
    ]);
  });

  it('queues a repository source that has never synced — the boot sweep', async () => {
    // What the server runs once the queue is up: a source no push will ever
    // reach (a migrated one, or one whose first sync was lost) is synced here.
    const h = harness([{ workspaceOrgId: 'org_A', sourceId: 'repo-acme-api' }]);
    expect(await h.schedule.sweep()).toBe(1);
    h.schedule.stop();
    expect(h.enqueued).toEqual([
      { workspaceOrgId: 'org_A', sourceId: 'repo-acme-api', source: 'schedule' },
    ]);
  });

  it('counts a source already in flight as not queued, and carries on', async () => {
    const h = harness([{ workspaceOrgId: 'org_A', sourceId: 'site-a' }], { status: 'busy' });
    expect(await h.schedule.sweep()).toBe(0);
    h.schedule.stop();
    expect(h.enqueued).toHaveLength(1);
  });

  it('runs on the timer, never on its own at start', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([{ workspaceOrgId: 'org_A', sourceId: 'site-a' }], undefined, {
        intervalMs: 1000,
      });
      expect(h.enqueued).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.enqueued).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.enqueued).toHaveLength(2);
      h.schedule.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.enqueued).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a tick that cannot read the database', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const enqueued: unknown[] = [];
      const schedule = startContextSyncSchedule(null, {
        due: async () => {
          calls += 1;
          if (calls === 1) throw new Error('database is down');
          return [{ workspaceOrgId: 'org_A', sourceId: 'site-a' }];
        },
        enqueue: async (request) => {
          enqueued.push(request);
          return { status: 'queued', jobId: 'job_1' } as const;
        },
        intervalMs: 1000,
        now: () => NOW,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(enqueued).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(enqueued).toHaveLength(1);
      schedule.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
