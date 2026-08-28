/**
 * Connect router (protected — mounted behind the host's auth gate). Powers the
 * dashboard's GitHub integration page: install URL, post-install linking, and
 * connecting repos. Everything is scoped to the authenticated user's workspace.
 *
 * What happens to a repo once it is connected — or once it is disconnected —
 * is not this router's business: it hands the link to
 * {@link ConnectDeps.onRepoLinked} / {@link ConnectDeps.onRepoUnlinked} and
 * returns.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import { getProjectByPath } from '@truecourse/core/config/registry';
import { loadSpec, loadLatestSpec } from '@truecourse/core/lib/spec-store';
import { openConflicts, type CorpusLike, type DecisionsLike } from '@truecourse/shared';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
  GithubInstallationSummary,
  GithubRepoSummary,
} from '@truecourse/shared';
import type { OctokitClient } from './octokit.js';
import { resolveNotificationPrefs } from './notifications.js';
import type { GateStore, InstallationRecord, RepoLinkRecord } from './store/types.js';

function orgIdOf(req: Request): string | null {
  const user = (req as Request & { user?: AuthUser }).user;
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
  };
}

/**
 * Follow-up work on a freshly connected repo — registering it as a project,
 * kicking its initial scan, whatever the host wires up. Runs after the link is
 * persisted, with an installation-scoped client for the repo's own installation.
 */
export type OnRepoLinked = (
  link: RepoLinkRecord,
  octokit: OctokitClient,
) => Promise<void>;

/**
 * Cleanup for a repo the user just disconnected — dropping the project it was
 * registered as, deleting the managed clone. Runs after the link is gone, with
 * the record that was removed (the link itself is no longer readable).
 */
export type OnRepoUnlinked = (link: RepoLinkRecord) => Promise<void>;

export interface ConnectDeps {
  store: GateStore;
  appSlug: string;
  /** Dashboard client origin, for browser-facing redirects (e.g. /setup). */
  appUrl: string;
  /** Installation-scoped GitHub client, for listing the repos a user can connect. */
  octokitFor: (installationId: number) => OctokitClient;
  /**
   * Post-link hook. Best-effort: a failure is logged and never fails the link,
   * so the repo stays connected even when the follow-up work can't run.
   */
  onRepoLinked?: OnRepoLinked;
  /**
   * Post-unlink hook. Best-effort on the same terms as {@link onRepoLinked}:
   * the link is already gone, so a failing cleanup must not report a failed
   * disconnect the user cannot retry.
   */
  onRepoUnlinked?: OnRepoUnlinked;
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
    // deep-link to `/repos/:slug`, plus its flagged-overlap count (within-area
    // doc disagreements awaiting a relation) so the list can flag repos that need review.
    const repoSummaries = await Promise.all(
      repos.map(async (r) => {
        // Read the corpus at the BASELINE commit — the repo's default-branch view —
        // never the newest scan, which may be an in-flight PR head (that spec is
        // PR-scoped and must not leak into the repo overview).
        const [project, baseline] = await Promise.all([
          getProjectByPath(r.repoFullName),
          deps.store.getBaseline(r.repoFullName).catch(() => null),
        ]);
        const commit = baseline?.commitSha ?? null;
        const corpus = commit
          ? await loadSpec<CorpusLike>({ repoKey: r.repoFullName, commitSha: commit }, 'corpus').catch(
              () => null,
            )
          : null;
        // Open = the SAME shared derivation the generate gate and the Coverage
        // sidebar use. A verdict/dismissal/exclude resolves a dispute WITHOUT
        // removing the flagged overlap from the corpus, so a raw overlap count
        // would keep a repo "Needs review" forever after its conflicts are resolved.
        const decisions = corpus
          ? ((await loadLatestSpec<DecisionsLike>(r.repoFullName, 'decisions').catch(() => null)) ?? {})
          : {};
        const openCount = corpus?.areas ? openConflicts(corpus, decisions).length : 0;
        return toRepoSummary(r, project?.slug ?? null, openCount);
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
    // Land back on the connect dialog so the new installation is immediately
    // pickable.
    res.redirect(`${deps.appUrl}/preview?connect=1`);
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
    const link: RepoLinkRecord = {
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
    };
    await deps.store.linkRepo(link);

    // Hand the connected repo to the host (project registration, initial scan).
    // Best-effort: the repo is already linked, so a failing hook must not turn
    // the user's successful connect into an error.
    if (deps.onRepoLinked) {
      try {
        await deps.onRepoLinked(link, deps.octokitFor(installationId));
      } catch (err) {
        log.warn(
          `[github-app] post-link handling failed for ${repoFullName}: ${(err as Error).message}`,
        );
      }
    }

    res.status(201).json({ ok: true });
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
      if (deps.onRepoUnlinked) {
        try {
          await deps.onRepoUnlinked(existing);
        } catch (err) {
          log.warn(
            `[github-app] post-unlink cleanup failed for ${repoFullName}: ${(err as Error).message}`,
          );
        }
      }
    }
    res.json({ ok: true });
  });

  return router;
}
