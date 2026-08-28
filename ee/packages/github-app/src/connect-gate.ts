/**
 * The gate's half of the connect API, mounted alongside the connection router
 * from `@truecourse/scm-github` at the same base path: per-repo gate settings
 * and the run feeds the dashboard reads. Also the post-link hook that router
 * calls once a repo is connected.
 */

import { Router, type Request, type Response } from 'express';
import { registerProject, getProjectByPath } from '@truecourse/core/config/registry';
import {
  NOTIFICATION_KEYS,
  resolveNotificationPrefs,
  splitRepo,
  type BaselineTrigger,
  type GateRunRecord,
  type GateStore,
  type OctokitClient,
  type OnRepoLinked,
  type PrRecord,
  type PrState,
  type RepoLinkRecord,
} from '@truecourse/scm-github';
import type {
  AuthUser,
  GithubRunSummary,
  WorkspaceRunItem,
} from '@truecourse/shared';

/** Conservative email shape: one `@`, non-empty local/domain, dotted domain. */
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTIFY_EMAILS = 20;

function orgIdOf(req: Request): string | null {
  const user = (req as Request & { user?: AuthUser }).user;
  return user?.organizationId ?? null;
}

/**
 * PR-state fields grafted onto every feed row. `prState` is null for PRs with no
 * gh_prs row (history predating close-tracking); the client treats null as open.
 * Defined locally rather than on the shared feed types (which the OSS dashboard
 * also consumes) — the fields are additive, so those consumers simply ignore them.
 */
type PrFeedFields = { prState: PrState | null; title: string | null };
type RunSummaryWithState = GithubRunSummary & PrFeedFields;
type WorkspaceRunItemWithState = WorkspaceRunItem & PrFeedFields;

function toRunSummary(r: GateRunRecord): GithubRunSummary {
  return {
    id: r.id,
    prNumber: r.prNumber,
    headSha: r.headSha,
    conclusion: r.conclusion,
    addedCount: r.addedCount,
    resolvedCount: r.resolvedCount,
    createdAt: r.createdAt,
  };
}

function prMapFor(prs: PrRecord[]): Map<number, PrRecord> {
  return new Map(prs.map((p) => [p.prNumber, p]));
}

function prFieldsFor(pr: PrRecord | undefined): PrFeedFields {
  return { prState: pr?.state ?? null, title: pr?.title ?? null };
}

/** Enqueue a repo scan; see `EnqueueBaseline` in the package entry point. */
type EnqueueScan = (trigger: BaselineTrigger) => Promise<string | null>;

/**
 * What the gate does with a freshly connected repo: surface it in the dashboard's
 * project list, then kick the INITIAL scan (background job) rather than waiting
 * for the next default-branch push, so the repo's spec + Code Quality baseline
 * populate as soon as it's connected. Without a queue wired there is no scan to
 * enqueue, so the branch head isn't resolved either.
 */
export function createRepoLinkedHook(enqueueBaseline?: EnqueueScan): OnRepoLinked {
  return async (link: RepoLinkRecord, octokit: OctokitClient) => {
    // Keyed by `owner/repo`, deterministic slug.
    await registerProject(link.repoFullName, link.repoFullName);
    if (!enqueueBaseline) return;
    const branch = await octokit.repos.getBranch({
      ...splitRepo(link.repoFullName),
      branch: link.defaultBranch,
    });
    await enqueueBaseline({
      repoFullName: link.repoFullName,
      installationId: link.installationId,
      defaultBranch: link.defaultBranch,
      commitSha: branch.data.commit.sha,
      workspaceOrgId: link.workspaceOrgId,
    });
  };
}

export interface ConnectGateDeps {
  store: GateStore;
}

export function createConnectGateRouter(deps: ConnectGateDeps): Router {
  const router = Router();

  router.patch('/repos/config', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const repoFullName = body.repoFullName;
    if (typeof repoFullName !== 'string') {
      res.status(400).json({ error: 'repoFullName required' });
      return;
    }
    const existing = await deps.store.getRepo(repoFullName);
    if (!existing || existing.workspaceOrgId !== orgId) {
      res.status(404).json({ error: 'repo not connected' });
      return;
    }

    let notifyEmails = existing.notifyEmails;
    if (body.notifyEmails !== undefined) {
      if (!Array.isArray(body.notifyEmails)) {
        res.status(400).json({ error: 'notifyEmails must be an array' });
        return;
      }
      const normalized = (body.notifyEmails as unknown[]).map((e) =>
        typeof e === 'string' ? e.trim().toLowerCase() : '',
      );
      const invalid = normalized.filter((e) => e && !VALID_EMAIL.test(e));
      if (invalid.length > 0) {
        res
          .status(400)
          .json({ error: `invalid email(s): ${invalid.slice(0, 3).join(', ')}` });
        return;
      }
      const deduped = [...new Set(normalized.filter(Boolean))];
      if (deduped.length > MAX_NOTIFY_EMAILS) {
        res
          .status(400)
          .json({ error: `at most ${MAX_NOTIFY_EMAILS} notify addresses` });
        return;
      }
      notifyEmails = deduped;
    }

    // Per-type notification toggles — merge any provided booleans onto the
    // resolved (defaults-applied) prefs so a partial PATCH only flips what it sends.
    let notifications = existing.notifications;
    if (body.notifications !== undefined) {
      const incoming = body.notifications;
      if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
        res.status(400).json({ error: 'notifications must be an object' });
        return;
      }
      const merged = resolveNotificationPrefs(existing);
      for (const key of NOTIFICATION_KEYS) {
        const v = (incoming as Record<string, unknown>)[key];
        if (typeof v === 'boolean') merged[key] = v;
      }
      notifications = merged;
    }

    let codeQualityMinSeverity = existing.codeQualityMinSeverity ?? 'high';
    if (body.codeQualityMinSeverity !== undefined) {
      const valid = ['info', 'low', 'medium', 'high', 'critical'];
      if (
        typeof body.codeQualityMinSeverity !== 'string' ||
        !valid.includes(body.codeQualityMinSeverity)
      ) {
        res.status(400).json({ error: 'invalid codeQualityMinSeverity' });
        return;
      }
      codeQualityMinSeverity = body.codeQualityMinSeverity as typeof codeQualityMinSeverity;
    }

    await deps.store.linkRepo({
      ...existing,
      blocking:
        typeof body.blocking === 'boolean' ? body.blocking : existing.blocking,
      codeQualityBlocking:
        typeof body.codeQualityBlocking === 'boolean'
          ? body.codeQualityBlocking
          : existing.codeQualityBlocking,
      codeQualityMinSeverity,
      enabled:
        typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      notifyEmails,
      notifications,
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  });

  router.get('/repos/:owner/:repo/runs', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    const repoFullName = `${req.params.owner}/${req.params.repo}`;
    const link = await deps.store.getRepo(repoFullName);
    if (!orgId || !link || link.workspaceOrgId !== orgId) {
      res.json({ runs: [] });
      return;
    }
    const [runs, prs] = await Promise.all([
      deps.store.listRuns(repoFullName),
      deps.store.listPrs(repoFullName),
    ]);
    const byPr = prMapFor(prs);
    const withState: RunSummaryWithState[] = runs.map((r) => ({
      ...toRunSummary(r),
      ...prFieldsFor(byPr.get(r.prNumber)),
    }));
    res.json({ runs: withState });
  });

  // Cross-repo gate activity for the workspace home — recent runs across every
  // connected repo, merged + newest-first. (N small per-repo reads; the repo
  // count per workspace is bounded.)
  router.get('/runs', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      res.json({ runs: [] });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const repos = await deps.store.listReposForWorkspace(orgId);
    const all: WorkspaceRunItemWithState[] = [];
    for (const repo of repos) {
      // The registered slug (lossy slugify with collision suffixes), so the feed
      // can deep-link each run to /repos/:slug?pr=N. Resolved once per repo.
      const slug = (await getProjectByPath(repo.repoFullName))?.slug ?? null;
      const [runs, prs] = await Promise.all([
        deps.store.listRuns(repo.repoFullName, limit),
        deps.store.listPrs(repo.repoFullName),
      ]);
      const prByNumber = prMapFor(prs);
      for (const r of runs) {
        all.push({
          ...toRunSummary(r),
          repoFullName: repo.repoFullName,
          slug,
          ...prFieldsFor(prByNumber.get(r.prNumber)),
        });
      }
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // One row per PR: keep only the newest run per (repo, PR). A PR with several
    // gate runs (one per pushed commit) collapses to a single row. `all` is already
    // newest-first, so the first run seen per key is the latest — and the limit now
    // counts PRs, not commits.
    const byPr = new Map<string, WorkspaceRunItemWithState>();
    for (const r of all) {
      const k = `${r.repoFullName}#${r.prNumber}`;
      if (!byPr.has(k)) byPr.set(k, r);
    }
    res.json({ runs: [...byPr.values()].slice(0, limit) });
  });

  return router;
}
