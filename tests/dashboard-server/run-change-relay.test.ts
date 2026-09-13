/**
 * The run-change relay: the sessions store's announcements as frames on the
 * workspace's live stream.
 *
 * What is pinned here is the whole contract the Agent page depends on — WHOSE
 * stream a write reaches (a repository's through the link store, a workspace's
 * own straight off its key), that a repository nobody connected tells nobody,
 * and that a busy run's burst of writes costs one frame at the head of the
 * window and one at its end, per run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerEvent } from '@truecourse/shared';
import { startRunChangeRelay } from '../../apps/dashboard/server/src/services/run-events.service';

const WINDOW_MS = 500;

function relay(links: Record<string, string> = { 'acme/widget': 'org_A' }) {
  const published: { org: string; event: ServerEvent }[] = [];
  const workspaceOf = vi.fn(async (repoKey: string) => links[repoKey] ?? null);
  let announce: (repoKey: string, runId: string) => void = () => {};
  let subscribed = true;
  const stop = startRunChangeRelay(
    {
      subscribe: (notify) => {
        announce = notify;
        return () => {
          subscribed = false;
        };
      },
      workspaceOf,
      publish: async (org, event) => {
        published.push({ org, event });
      },
    },
    WINDOW_MS,
  );
  return {
    published,
    workspaceOf,
    write: (repoKey: string, runId: string) => announce(repoKey, runId),
    stop,
    subscribed: () => subscribed,
  };
}

/** The relay publishes off a promise chain; let it settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the run-change relay', () => {
  it("sends a repository's write to the workspace that connected it", async () => {
    const r = relay();
    r.write('acme/widget', 'run-1');
    await settle();

    expect(r.published).toEqual([
      { org: 'org_A', event: { type: 'run.changed', runId: 'run-1', repoKey: 'acme/widget' } },
    ]);
    r.stop();
  });

  it("reads a workspace run's owner off its key, with no lookup at all", async () => {
    const r = relay();
    r.write('workspace:org_B', 'run-scan');
    await settle();

    expect(r.published).toEqual([
      {
        org: 'org_B',
        event: { type: 'run.changed', runId: 'run-scan', repoKey: 'workspace:org_B' },
      },
    ]);
    expect(r.workspaceOf).not.toHaveBeenCalled();
    r.stop();
  });

  it('tells nobody about a repository no workspace has connected', async () => {
    const r = relay();
    r.write('stranger/repo', 'run-2');
    await settle();

    expect(r.published).toEqual([]);
    r.stop();
  });

  it("coalesces a run's burst into one frame at each end of the window", async () => {
    vi.useFakeTimers();
    const r = relay();

    for (let i = 0; i < 6; i++) r.write('acme/widget', 'run-1');
    await settle();
    expect(r.published).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    await settle();
    expect(r.published).toHaveLength(2);

    // The window closes behind a run that went quiet, and the next write is
    // immediate again rather than waiting one out.
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    await settle();
    expect(r.published).toHaveLength(2);

    r.write('acme/widget', 'run-1');
    await settle();
    expect(r.published).toHaveLength(3);
    expect(r.published.every((p) => p.event.type === 'run.changed')).toBe(true);
    r.stop();
  });

  it('windows each run on its own', async () => {
    vi.useFakeTimers();
    const r = relay();

    r.write('acme/widget', 'run-1');
    r.write('acme/widget', 'run-2');
    r.write('workspace:org_B', 'run-3');
    await settle();

    expect(
      r.published.map((p) => (p.event as { runId: string }).runId).sort(),
    ).toEqual(['run-1', 'run-2', 'run-3']);
    r.stop();
  });

  it('stops reading the store when it is stopped', async () => {
    vi.useFakeTimers();
    const r = relay();
    r.write('acme/widget', 'run-1');
    await settle();

    r.stop();
    expect(r.subscribed()).toBe(false);
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);
    await settle();
    expect(r.published).toHaveLength(1);
  });
});
