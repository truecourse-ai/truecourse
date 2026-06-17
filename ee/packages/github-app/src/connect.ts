/**
 * Connect router (protected — behind the enterprise auth gate). Powers the
 * dashboard's GitHub integration page: install URL, post-install linking,
 * connecting repos to the gate, and run history. Everything is scoped to the
 * authenticated user's workspace (WorkOS org).
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import { registerProject, getProjectByPath } from '@truecourse/core/config/registry';
import { getScanState } from '@truecourse/core/commands/spec-in-process';
import { latestSpecCommit } from '@truecourse/core/lib/spec-store';
import { listContractFiles } from '@truecourse/core/lib/contract-store';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
  GithubInstallationSummary,
  GithubRepoSummary,
  GithubRunSummary,
  WorkspaceRunItem,
} from '@truecourse/shared';
import type { OctokitClient } from './octokit.js';
import { resolveNotificationPrefs, NOTIFICATION_KEYS } from './notifications.js';
import type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  GateRunRecord,
} from './store/types.js';

/** Conservative email shape: one `@`, non-empty local/domain, dotted domain. */
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTIFY_EMAILS = 20;

function orgIdOf(req: Request): string | null {
  const user = (req as Request & { eeUser?: AuthUser }).eeUser;
  return user?.organizationId ?? null;
}

function toInstallationSummary(
  r: InstallationRecord,
): GithubInstallationSummary {
  return {
    installationId: r.installationId,
    accountLogin: r.accountLogin,
    accountType: r.accountType,
  };
}

function toRepoSummary(
  r: RepoLinkRecord,
  slug: string | null,
  openConflicts: number,
  hasContracts: boolean,
): GithubRepoSummary {
  return {
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    defaultBranch: r.defaultBranch,
    blocking: r.blocking,
    codeQualityBlocking: r.codeQualityBlocking ?? true,
    codeQualityMinSeverity: r.codeQualityMinSeverity ?? 'high',
    enabled: r.enabled,
    notifyEmails: r.notifyEmails ?? [],
    notifications: resolveNotificationPrefs(r),
    slug,
    openConflicts,
    hasContracts,
  };
}

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

export interface ConnectDeps {
  store: GateStore;
  appSlug: string;
  /** Dashboard client origin, for browser-facing redirects (e.g. /setup). */
  appUrl: string;
  /** Installation-scoped GitHub client, for listing the repos a user can connect. */
  octokitFor: (installationId: number) => OctokitClient;
  /**
   * Enqueue the initial repo scan on connect (background job). Returns the job id
   * or null when one is already running. Omitted ⇒ no auto-scan (e.g. tests).
   */
  enqueueBaseline?: (req: {
    repoFullName: string;
    installationId: number;
    defaultBranch: string;
    commitSha: string;
    workspaceOrgId: string;
  }) => Promise<string | null>;
}

export function createConnectRouter(deps: ConnectDeps): Router {
  const router = Router();

  const buildInstallUrl = (orgId: string): string =>
    `https://github.com/apps/${deps.appSlug}/installations/new?state=${encodeURIComponent(orgId)}`;

  router.get('/status', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      const empty: GithubConnectStatusResponse = {
        configured: true,
        installUrl: '',
        installations: [],
        repos: [],
      };
      res.json(empty);
      return;
    }
    const [installations, repos] = await Promise.all([
      deps.store.listInstallationsForWorkspace(orgId),
      deps.store.listReposForWorkspace(orgId),
    ]);
    // Resolve each repo's dashboard slug (registered on link) so the UI can
    // deep-link to `/repos/:slug`, plus its open-conflict count (re-merged from
    // stored claims — no LLM) so the list can flag repos that need review.
    const repoSummaries = await Promise.all(
      repos.map(async (r) => {
        const [project, scan, commit] = await Promise.all([
          getProjectByPath(r.repoFullName),
          getScanState(r.repoFullName).catch(() => null),
          latestSpecCommit(r.repoFullName).catch(() => null),
        ]);
        // hasContracts: any generated contract files at the latest scanned commit.
        const files = commit
          ? await listContractFiles(r.repoFullName, 'contracts', commit).catch(() => [])
          : [];
        return toRepoSummary(
          r,
          project?.slug ?? null,
          scan?.openConflicts.length ?? 0,
          files.length > 0,
        );
      }),
    );
    const body: GithubConnectStatusResponse = {
      configured: true,
      installUrl: buildInstallUrl(orgId),
      installations: installations.map(toInstallationSummary),
      repos: repoSummaries,
    };
    res.json(body);
  });

  // Repos the installation can access — populates the connect drawer's repo
  // picker (so users choose from a list instead of typing `owner/name`).
  router.get(
    '/installations/:installationId/repos',
    async (req: Request, res: Response) => {
      const orgId = orgIdOf(req);
      const installationId = Number(req.params.installationId);
      if (!orgId || !Number.isInteger(installationId)) {
        res.status(400).json({ error: 'installationId required' });
        return;
      }
      // Ownership: only list repos for an installation in the caller's workspace.
      const inst = await deps.store.getInstallation(installationId);
      if (!inst || inst.workspaceOrgId !== orgId) {
        res.status(403).json({ error: 'installation not in your workspace' });
        return;
      }
      try {
        const octokit = deps.octokitFor(installationId);
        const repos = await octokit.paginate(
          octokit.apps.listReposAccessibleToInstallation,
          { per_page: 100 },
        );
        const body: GithubInstallationReposResponse = {
          repos: repos.map(
            (r): GithubInstallableRepo => ({
              fullName: r.full_name,
              defaultBranch: r.default_branch,
              private: r.private,
            }),
          ),
        };
        res.json(body);
      } catch (err) {
        res
          .status(502)
          .json({ error: `could not list repositories: ${(err as Error).message}` });
      }
    },
  );

  // Post-install redirect target (configured as the App's Setup URL). GitHub
  // sends the browser here with ?installation_id=&state=<orgId>; we associate
  // the installation with the user's workspace, then bounce back to the page
  // (absolute URL — the SPA lives on the client origin, not this API origin).
  router.get('/setup', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    const installationId = Number(req.query.installation_id);
    const state = typeof req.query.state === 'string' ? req.query.state : null;

    // Bind the install to the authenticated session's workspace. The orgId
    // comes from the session (trusted); `state` is a defense-in-depth check
    // that the install URL we issued round-tripped intact.
    if (orgId && Number.isInteger(installationId) && (state === null || state === orgId)) {
      const inst = await deps.store.getInstallation(installationId);
      if (!inst) {
        // The setup redirect raced ahead of the installation webhook — stub
        // the record with the owning workspace; the webhook fills account
        // details later (its upsert preserves the workspace link).
        const now = new Date().toISOString();
        await deps.store.saveInstallation({
          installationId,
          accountLogin: '',
          accountType: '',
          workspaceOrgId: orgId,
          createdAt: now,
          updatedAt: now,
        });
      } else if (inst.workspaceOrgId == null || inst.workspaceOrgId === orgId) {
        await deps.store.linkInstallationToWorkspace(installationId, orgId);
      }
      // Else: the installation already belongs to another workspace — never
      // re-link it (prevents cross-tenant installation takeover).
    }
    res.redirect(`${deps.appUrl}/repositories`);
  });

  router.post('/repos/link', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { repoFullName, installationId, defaultBranch, blocking } = body;
    if (
      typeof repoFullName !== 'string' ||
      typeof installationId !== 'number' ||
      typeof defaultBranch !== 'string'
    ) {
      res
        .status(400)
        .json({ error: 'repoFullName, installationId, defaultBranch required' });
      return;
    }
    // Ownership: the installation must belong to this workspace.
    const inst = await deps.store.getInstallation(installationId);
    if (!inst || inst.workspaceOrgId !== orgId) {
      res.status(403).json({ error: 'installation not in your workspace' });
      return;
    }
    const now = new Date().toISOString();
    const existing = await deps.store.getRepo(repoFullName);
    // Repos are keyed globally by full name; never let one workspace overwrite
    // a repo another workspace already connected.
    if (existing && existing.workspaceOrgId !== orgId) {
      res
        .status(409)
        .json({ error: 'repository already connected to another workspace' });
      return;
    }
    await deps.store.linkRepo({
      repoFullName,
      installationId,
      workspaceOrgId: orgId,
      defaultBranch,
      blocking: typeof blocking === 'boolean' ? blocking : existing?.blocking ?? true,
      // Code Quality config is set via the settings PATCH, not connect — preserve it.
      codeQualityBlocking: existing?.codeQualityBlocking ?? true,
      codeQualityMinSeverity: existing?.codeQualityMinSeverity ?? 'high',
      enabled: true,
      notifyEmails: existing?.notifyEmails ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    // Surface the connected repo in the dashboard's project list immediately
    // (keyed by `owner/repo`, deterministic slug).
    await registerProject(repoFullName, repoFullName);

    // Kick off the INITIAL scan now (background job) rather than waiting for the
    // next default-branch push — so the repo's spec/contracts (and the merge with
    // workspace Knowledge) populate as soon as it's connected, in either order.
    // Best-effort: a failure to enqueue must not fail the link.
    if (deps.enqueueBaseline) {
      try {
        const [owner, repo] = repoFullName.split('/');
        const octokit = deps.octokitFor(installationId);
        const branch = await octokit.repos.getBranch({ owner, repo, branch: defaultBranch });
        await deps.enqueueBaseline({
          repoFullName,
          installationId,
          defaultBranch,
          commitSha: branch.data.commit.sha,
          workspaceOrgId: orgId,
        });
      } catch (err) {
        log.warn(`[github-app] initial scan enqueue failed for ${repoFullName}: ${(err as Error).message}`);
      }
    }

    res.status(201).json({ ok: true });
  });

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

  router.delete('/repos/link', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const repoFullName = req.query.repoFullName;
    if (typeof repoFullName !== 'string') {
      res.status(400).json({ error: 'repoFullName required' });
      return;
    }
    const existing = await deps.store.getRepo(repoFullName);
    if (existing && existing.workspaceOrgId === orgId) {
      await deps.store.unlinkRepo(repoFullName);
    }
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
    const runs = await deps.store.listRuns(repoFullName);
    res.json({ runs: runs.map(toRunSummary) });
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
    const all: WorkspaceRunItem[] = [];
    for (const repo of repos) {
      // The registered slug (lossy slugify with collision suffixes), so the feed
      // can deep-link each run to /repos/:slug?pr=N. Resolved once per repo.
      const slug = (await getProjectByPath(repo.repoFullName))?.slug ?? null;
      const runs = await deps.store.listRuns(repo.repoFullName, limit);
      for (const r of runs) {
        all.push({ ...toRunSummary(r), repoFullName: repo.repoFullName, slug });
      }
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // One row per PR: keep only the newest run per (repo, PR). A PR with several
    // gate runs (one per pushed commit) collapses to a single row. `all` is already
    // newest-first, so the first run seen per key is the latest — and the limit now
    // counts PRs, not commits.
    const byPr = new Map<string, WorkspaceRunItem>();
    for (const r of all) {
      const k = `${r.repoFullName}#${r.prNumber}`;
      if (!byPr.has(k)) byPr.set(k, r);
    }
    res.json({ runs: [...byPr.values()].slice(0, limit) });
  });

  return router;
}
