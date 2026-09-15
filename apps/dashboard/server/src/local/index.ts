/**
 * The LOCAL FOLDER provider: a directory on this machine, connected the way a
 * hosted repository is.
 *
 * It exists only in local mode, where the server and the developer share a
 * filesystem. Connecting writes the same `repositories` row every provider
 * writes — the row IS the connection — with the folder's absolute path as its
 * location, and everything downstream (Code, Context, the jobs, the registry)
 * reads it without knowing where it came from.
 *
 * A RUN NEVER TOUCHES THE FOLDER. `guard setup` writes inside the tree it is
 * given, and that tree is a copy made under the run-clones dir and deleted when
 * the run settles (see `createRunCopy`). The developer's checkout is read once,
 * copied, and left exactly as it was.
 *
 * There is no webhook to tell us the folder moved, so the two ways it re-reads
 * are a Sync now in Context and the WATCHER installed here: a change under a
 * connected folder enqueues that repository's context sync, debounced.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import type {
  LocalRepositoriesResponse,
  LocalRepositorySummary,
  RepositoryLink,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import { createRunCopy } from '../services/run-clone.service.js';
import { setWorkTreeProvider, type WorkTreeProvider } from '../services/work-tree.service.js';
import {
  syncRepositorySource,
  type ContextSyncStart,
} from '../services/context-lifecycle.service.js';
import { setRepoWatchStopper } from '../services/repo-removal.service.js';
import { stopWatching, watchRepo } from '../services/watcher.service.js';

/** How connecting a folder starts its Flow setup: the queue's answer, as a word. */
export type LocalSetupStart = (link: RepositoryRecord) => Promise<'queued' | 'busy' | 'failed'>;

export interface LocalConnectionDeps {
  /** The connected repositories — the same table every provider writes. */
  repos: RepositoryStore;
  /** Start the repository's Flow setup. Without one the folder is connected and left. */
  startSetup?: LocalSetupStart;
  /** Re-read the repository's own documentation after the folder changed. */
  contextSync?: ContextSyncStart;
}

export interface LocalMount {
  /** Workspace-scoped routes; mount at `/api/local`, BEHIND the gate. */
  router: Router;
  /** Start watching every folder this workspace already connected. */
  watchConnected(workspaceOrgId: string): Promise<void>;
  /** Stop every watcher (shutdown). */
  stop(): void;
}

function orgIdOf(req: Request): string | null {
  return req.user?.organizationId ?? null;
}

/** `local/<folder>` — the identity every per-repository store keys this folder by. */
function repoNameFor(folder: string): string {
  const base =
    path
      .basename(folder)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[.\-]+|[.\-]+$/g, '') || 'folder';
  return `local/${base}`;
}

/** The same name with a counter, so two folders of one name are two repositories. */
function uniqueRepoName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What a folder must be to become a repository, in the words the reader gets. */
function refuse(folder: string): string | null {
  if (!path.isAbsolute(folder)) return 'Give the folder’s full path, starting at the root.';
  if (!fs.existsSync(folder)) return `There is no folder at ${folder}.`;
  if (!fs.statSync(folder).isDirectory()) return `${folder} is a file, not a folder.`;
  if (!fs.existsSync(path.join(folder, '.git'))) {
    return `${folder} is not a git repository. TrueCourse identifies what a run produced by the commit it ran on, so a repository must have one.`;
  }
  return null;
}

const noSetupRunner: LocalSetupStart = async (link) => {
  log.warn(`[local] background jobs are not running — ${link.repoFullName} was not set up`);
  return 'failed';
};

function toSummary(r: RepositoryRecord): LocalRepositorySummary {
  return {
    repoFullName: r.repoFullName,
    path: r.location ?? '',
    connectedAt: r.createdAt,
  };
}

export function createLocalConnection(deps: LocalConnectionDeps): LocalMount {
  const startSetup = deps.startSetup ?? noSetupRunner;
  /** The folder each connected repository is watched at. */
  const watched = new Map<string, string>();

  /**
   * The folder's files, copied into a fresh per-run tree. A caller that already
   * knows where the folder is (a context source over one) is not looked up.
   */
  const workTree: WorkTreeProvider = async (repoKey, via) => {
    const connected = via?.location ? null : await deps.repos.getRepo(repoKey);
    const folder = via?.location ?? connected?.location;
    if (!folder) {
      throw new Error(`${repoKey} is not a folder connected on this machine`);
    }
    return createRunCopy(folder, {
      workspaceOrgId: via?.workspaceOrgId ?? connected?.workspaceOrgId ?? 'workspace',
    });
  };
  setWorkTreeProvider('local', workTree);

  /** Watch a folder, so a change re-reads the repository's own documentation. */
  const watch = (org: string, repo: RepositoryRecord): void => {
    const folder = repo.location;
    const sync = deps.contextSync;
    if (!folder || !sync || watched.has(repo.repoFullName)) return;
    watchRepo(folder, () => {
      syncRepositorySource(org, repo.repoFullName, sync);
    });
    watched.set(repo.repoFullName, folder);
  };

  /** Disconnecting a repository stops the watcher over its folder. */
  const unwatch = (repoFullName: string): void => {
    const folder = watched.get(repoFullName);
    if (!folder) return;
    stopWatching(folder);
    watched.delete(repoFullName);
  };
  setRepoWatchStopper(unwatch);

  const router = Router();

  // The folders this workspace has connected, which is what Settings draws.
  router.get('/repos', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    const body: LocalRepositoriesResponse = {
      repos: org
        ? (await deps.repos.listReposForWorkspace(org))
            .filter((r) => r.provider === 'local')
            .map(toSummary)
        : [],
    };
    res.json(body);
  });

  // Connect a folder: validate it, write the row, start its setup.
  router.post('/repos', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const raw = (req.body as { path?: unknown })?.path;
    const folder = typeof raw === 'string' ? path.resolve(raw.trim()) : '';
    if (!folder) {
      res.status(400).json({ error: 'A folder path is required.' });
      return;
    }
    const reason = refuse(folder);
    if (reason) {
      res.status(400).json({ error: reason });
      return;
    }

    const connected = await deps.repos.listReposForWorkspace(org);
    const already = connected.find((r) => r.provider === 'local' && r.location === folder);
    if (already) {
      res.status(409).json({ error: `${folder} is already connected.` });
      return;
    }

    const now = new Date().toISOString();
    const link: RepositoryLink = {
      repoFullName: uniqueRepoName(
        repoNameFor(folder),
        new Set(connected.map((r) => r.repoFullName)),
      ),
      provider: 'local',
      // A folder has no account behind it and no branch the provider tracks:
      // a run reads whatever is checked out.
      accountId: null,
      workspaceOrgId: org,
      defaultBranch: null,
      location: folder,
      blocking: true,
      enabled: true,
      notifyEmails: [],
      createdAt: now,
      updatedAt: now,
    };
    const stored = await deps.repos.linkRepo(link);
    watch(org, stored);

    try {
      const outcome = await startSetup(stored);
      if (outcome !== 'queued') {
        log.info(`[local] ${folder} connected — setup ${outcome}`);
      }
    } catch (err) {
      // A setup that could not start is not a reason to refuse the connection:
      // the folder is connected, and Set up still works.
      log.error(`[local] could not start ${link.repoFullName}'s setup: ${(err as Error).message}`);
    }

    res.status(201).json({ repoFullName: link.repoFullName });
  });

  return {
    router,
    watchConnected: async (workspaceOrgId: string) => {
      for (const repo of await deps.repos.listReposForWorkspace(workspaceOrgId)) {
        if (repo.provider === 'local') watch(workspaceOrgId, repo);
      }
    },
    stop: () => {
      for (const folder of watched.values()) stopWatching(folder);
      watched.clear();
      setRepoWatchStopper(null);
    },
  };
}
