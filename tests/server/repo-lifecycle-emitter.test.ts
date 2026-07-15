/**
 * The repo-lifecycle refresh bridge, dashboard-server side: hosted background
 * jobs (repo.baseline / repo.guard / guard.baseline) announce their completion
 * through the core `repo-lifecycle` seam, and the dashboard server's installed
 * emitter turns that into the SAME `spec:complete` socket event the OSS routes
 * emit — so a client sitting on the Spec/Scenarios/Runs tab refreshes live.
 *
 * Covers the core seam contract (no-op unset, best-effort) and the socket
 * emitter factory (repoKey → registry slug → emitSpecComplete into the room).
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
    await expect(emitRepoLifecycle('acme/api', 'guard-generate')).resolves.toBeUndefined();
  });

  it('hands (repoKey, kind) to the installed emitter', async () => {
    const emitter = vi.fn().mockResolvedValue(undefined);
    setRepoLifecycleEmitter(emitter);
    await emitRepoLifecycle('acme/api', 'scan');
    expect(emitter).toHaveBeenCalledWith('acme/api', 'scan');
  });

  it('swallows emitter errors — a refresh signal never fails the job that fired it', async () => {
    setRepoLifecycleEmitter(vi.fn().mockRejectedValue(new Error('socket down')));
    await expect(emitRepoLifecycle('acme/api', 'guard-run')).resolves.toBeUndefined();
  });
});

describe('createRepoLifecycleSocketEmitter', () => {
  it('resolves the repo slug from the registry and emits spec:complete with the kind', async () => {
    const emit = vi.fn();
    const emitter = createRepoLifecycleSocketEmitter({
      getProjectByPath: vi
        .fn()
        .mockResolvedValue({ slug: 'acme-api', name: 'acme/api', path: 'acme/api' }),
      emit,
    });
    await emitter('acme/api', 'guard-generate');
    expect(emit).toHaveBeenCalledWith('acme-api', 'guard-generate');
  });

  it('emits nothing for a repoKey the registry does not know', async () => {
    const emit = vi.fn();
    const emitter = createRepoLifecycleSocketEmitter({
      getProjectByPath: vi.fn().mockResolvedValue(null),
      emit,
    });
    await emitter('ghost/repo', 'scan');
    expect(emit).not.toHaveBeenCalled();
  });
});
