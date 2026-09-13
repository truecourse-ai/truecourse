/**
 * The workspace Document scan's server-side edges: who the workspace's
 * repositories are, and how a scan that died before it could open a run still
 * leaves a record behind.
 *
 * The scan engine itself is core's (`commands/context-scan`) — it reads the
 * context store, materializes the documents and curates them. What lives here
 * is what only this server knows: that a workspace's repositories are the ones
 * its Context bindings name, and that a run nobody can see is a run nobody can
 * explain.
 */

import type { RunError } from '@truecourse/agent-loop';
import { log } from '@truecourse/core/lib/logger';
import { createStoredSessionRun } from '@truecourse/core/lib/sessions-store';
import { workspaceSessionsKey } from '@truecourse/core/commands/context-scan';
import {
  getContextSource,
  listContextBindings,
} from '@truecourse/core/lib/context-store';
import { getProjectByPath } from '@truecourse/core/config/registry';
import type { RepositorySourceConfig } from '@truecourse/shared';
import type { RippleRepo } from '../jobs/context-ripple.js';

/**
 * Every repository of the workspace, with the sources it reads. A repository is
 * "of the workspace" by having a Context link — connecting one always creates
 * and links its Repository source, so the bindings ARE the membership list, and
 * they are workspace-scoped by construction (the registry is not).
 *
 * A repository source whose repository has somehow lost its link still names
 * that repository: its documents are the repository's own, and leaving it out
 * would hide a repository from the ripple that reads it.
 */
export async function workspaceRepositories(org: string): Promise<RippleRepo[]> {
  const bindings = await listContextBindings(org);
  const byRepo = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const set = byRepo.get(binding.repoFullName) ?? new Set<string>();
    set.add(binding.sourceId);
    byRepo.set(binding.repoFullName, set);
  }

  // Only a repository Code has connected has flows to keep: a source can read
  // a repository Code does not know, and that repository is nobody's to set up.
  const repos: RippleRepo[] = [];
  for (const [repoFullName, sourceIds] of [...byRepo.entries()].sort()) {
    const entry = await connectedEntry(repoFullName);
    if (!entry) continue;
    repos.push({ repoId: entry.slug, repoFullName, sourceIds: [...sourceIds].sort() });
  }
  return repos;
}

/**
 * The CONNECTED repository a source is the own documentation of, or null: for
 * a site, for a source that is already gone, and for a repository source Code
 * has not connected (its documents are read; nothing of it is set up).
 */
export async function repositoryOfSource(
  org: string,
  sourceId: string,
): Promise<{ repoId: string; repoFullName: string } | null> {
  const source = await getContextSource(org, sourceId);
  if (!source || source.kind !== 'repository') return null;
  const repoFullName = (source.config as RepositorySourceConfig).repoFullName;
  if (!repoFullName) return null;
  const entry = await connectedEntry(repoFullName);
  return entry ? { repoId: entry.slug, repoFullName } : null;
}

/** The registry entry of a repository Code has connected, or null. */
async function connectedEntry(repoFullName: string): Promise<{ slug: string } | null> {
  try {
    return await getProjectByPath(repoFullName);
  } catch {
    // A registry that will not answer must not stop the ripple; it just
    // ripples to nobody.
    return null;
  }
}

/**
 * Has the workspace's Context moved since the corpus was built? One stamp
 * against one stamp — the amber dot on Scan, and the `docsChanged` half of a
 * repository's staleness, are both exactly this question.
 *
 * Compared as instants rather than as strings: both stamps are ISO-8601 with a
 * `Z`, but their precision need not match (a corpus written before this existed
 * may carry whole seconds), and `'…:00Z' > '…:00.000Z'` is true as text and
 * false as time. A corpus that has never been built is not behind anything.
 */
export function contextIsStale(corpusAt: string | null, changedAt: string | null): boolean {
  if (!corpusAt || !changedAt) return false;
  const built = Date.parse(corpusAt);
  const moved = Date.parse(changedAt);
  if (Number.isNaN(built) || Number.isNaN(moved)) return changedAt > corpusAt;
  return moved > built;
}

/**
 * A workspace scan run that exists only to carry its own failure — the
 * pre-flight died before the scan could create one. Best-effort: a store that
 * cannot be written must not turn one failure into two. Answers with the run's
 * id so the job's notification can address it, and null when nothing was written.
 */
export async function recordFailedWorkspaceScanRun(
  org: string,
  error: RunError,
): Promise<string | null> {
  try {
    const run = await createStoredSessionRun(workspaceSessionsKey(org), {
      command: 'spec-scan',
      gitRef: 'unknown',
      activityStream: true,
    });
    run.finish('failed', { error });
    await run.flush?.();
    return run.runId;
  } catch (err) {
    log.warn(
      `[context] could not record the failed workspace scan for ${org}: ${(err as Error).message}`,
    );
    return null;
  }
}
