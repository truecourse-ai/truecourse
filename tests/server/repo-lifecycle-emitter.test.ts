/**
 * The repo-lifecycle refresh bridge, dashboard-server side: the background
 * jobs announce their completion through the core `repo-lifecycle` seam, and
 * the socket layer's installed emitter turns that into the SAME `spec:complete`
 * socket event the routes emit — so a client sitting on the Pipeline or Runs
 * tab refreshes live.
 *
 * Covers the core seam contract (no-op unset, best-effort) and the socket
 * emitter factory (workspace + repoKey → registry slug → emitSpecComplete into
 * the workspace's room).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setRepoLifecycleEmitter,
  emitRepoLifecycle,
} from '@truecourse/core/lib/repo-lifecycle';
import { createRepoLifecycleSocketEmitter } from '../../apps/dashboard/server/src/socket/repo-lifecycle';

afterEach(() => setRepoLifecycleEmitter(null));

describe('repo-lifecycle seam', () => {
  it('is a silent no-op when no emitter is installed', async () => {
    await expect(emitRepoLifecycle('org_A', 'acme/api', 'guard-generate')).resolves.toBeUndefined();
  });

  it('hands (workspace, repoKey, kind) to the installed emitter', async () => {
    const emitter = vi.fn().mockResolvedValue(undefined);
    setRepoLifecycleEmitter(emitter);
    await emitRepoLifecycle('org_A', 'acme/api', 'scan');
    expect(emitter).toHaveBeenCalledWith('org_A', 'acme/api', 'scan');
  });

  it('swallows emitter errors — a refresh signal never fails the job that fired it', async () => {
    setRepoLifecycleEmitter(vi.fn().mockRejectedValue(new Error('socket down')));
    await expect(emitRepoLifecycle('org_A', 'acme/api', 'guard-run')).resolves.toBeUndefined();
  });
});

describe('createRepoLifecycleSocketEmitter', () => {
  it("resolves the repo slug in its workspace's registry and emits spec:complete into that workspace's room", async () => {
    const emit = vi.fn();
    const getProjectByPath = vi
      .fn()
      .mockResolvedValue({ slug: 'acme-api', name: 'acme/api', path: 'acme/api' });
    const emitter = createRepoLifecycleSocketEmitter({ getProjectByPath, emit });
    await emitter('org_A', 'acme/api', 'guard-generate');
    expect(getProjectByPath).toHaveBeenCalledWith('org_A', 'acme/api');
    expect(emit).toHaveBeenCalledWith('org_A', 'acme-api', 'guard-generate');
  });

  it('emits nothing for a repoKey the registry does not know', async () => {
    const emit = vi.fn();
    const emitter = createRepoLifecycleSocketEmitter({
      getProjectByPath: vi.fn().mockResolvedValue(null),
      emit,
    });
    await emitter('org_A', 'ghost/repo', 'scan');
    expect(emit).not.toHaveBeenCalled();
  });
});
