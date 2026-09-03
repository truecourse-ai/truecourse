/**
 * Connect router (protected — mounted behind the host's auth gate). Powers the
 * dashboard's GitHub integration page: install URL, post-install linking, and
 * connecting repos. Everything is scoped to the authenticated user's workspace.
 *
 * WHAT happens to a repo once it is connected — or once it is disconnected — is
 * not this router's business: it hands the link to
 * {@link ConnectDeps.onRepoLinked} / {@link ConnectDeps.onRepoUnlinked}. WHETHER
 * it happened is: both hooks are transactional, so the link row and the work
 * behind it are never out of step (see the two hook types).
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
 * Follow-up work on a freshly connected repo — cloning it, registering it as a
 * project, kicking its initial scan, whatever the host wires up. Runs after the
 * link is persisted, with an installation-scoped client for the repo's own
 * installation.
 *
 * PART OF THE LINK: a hook that throws rolls the link back, because for a host
 * where the hook IS the connection (the OSS mount clones inside it) a link row
 * with none of that work behind it is a repo the UI calls connected and nothing
 * can act on.
 */
export type OnRepoLinked = (
  link: RepoLinkRecord,
  octokit: OctokitClient,
) => Promise<void>;

/**
 * Cleanup for a repo the user is disconnecting — dropping the project it was
 * registered as, deleting the managed clone. Runs BEFORE the link is removed,
 * so everything it touches is still owned by exactly one workspace while it
 * works; a hook that throws leaves the link intact and fails the request, since
 * a clone that outlives its link row is scoped to nobody and visible to all.
 */
export type OnRepoUnlinked = (link: RepoLinkRecord) => Promise<void>;

export interface ConnectDeps {
  store: GateStore;
  appSlug: string;
  /** Dashboard client origin, for browser-facing redirects (e.g. /setup). */
  appUrl: string;
  /**
   * Where the post-install redirect lands, relative to {@link appUrl} — the
   * host's own connect surface, since the two dashboards that mount this router
   * route it differently.
   */
  setupRedirectPath: string;
  /** Installation-scoped GitHub client, for listing the repos a user can connect. */
  octokitFor: (installationId: number) => OctokitClient;
  /**
   * Who an installation belongs to, read from the App API (app-level auth). The
   * account identity must not depend on the `installation` webhook: that
   * delivery can lose the race with the setup redirect, or never arrive at all
   * when the App's webhook URL is unreachable at install time.
   *
   * Best-effort — a null (or a throw) leaves the record as it is, and the UI
   * shows the installation id.
   */
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
  /** Post-link hook; see {@link OnRepoLinked}. Its failure fails the link. */
  onRepoLinked?: OnRepoLinked;
  /** Pre-unlink hook; see {@link OnRepoUnlinked}. Its failure fails the disconnect. */
  onRepoUnlinked?: OnRepoUnlinked;
}

/** An error's own HTTP status if it carries one, else a bad-gateway default. */
function statusOf(err: unknown): number {
  const status = (err as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 502;
}

export function createConnectRouter(deps: ConnectDeps): Router {
  const router = Router();

  const buildInstallUrl = (orgId: string): string =>
    `https://github.com/apps/${deps.appSlug}/installations/new?state=${encodeURIComponent(orgId)}`;

  /** The installation's account, or null — a lookup failure is never fatal here. */
  const lookupAccount = async (
    installationId: number,
  ): Promise<{ accountLogin: string; accountType: string } | null> => {
    if (!deps.lookupInstallationAccount) return null;
    try {
      const account = await deps.lookupInstallationAccount(installationId);
      return account?.accountLogin ? account : null;
    } catch (err) {
      log.warn(
        `[github] could not read the account of installation ${installationId}: ${(err as Error).message}`,
      );
      return null;
    }
  };

  /**
   * Name an installation the `installation` webhook never named, and persist it,
   * so a row stubbed by /setup stops rendering as `#<id>` from the next read on.
   * Returns the record to render — the healed one when the lookup answered.
   */
  const withAccount = async (inst: InstallationRecord): Promise<InstallationRecord> => {
    if (inst.accountLogin) return inst;
    const account = await lookupAccount(inst.installationId);
    if (!account) return inst;
    const named: InstallationRecord = {
      ...inst,
      ...account,
      updatedAt: new Date().toISOString(),
    };
    await deps.store.saveInstallation(named).catch((err: unknown) => {
      log.warn(
        `[github] could not save the account of installation ${inst.installationId}: ${(err as Error).message}`,
      );
    });
    return named;
  };

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
    const [listed, repos] = await Promise.all([
      deps.store.listInstallationsForWorkspace(orgId),
      deps.store.listReposForWorkspace(orgId),
    ]);
    // Self-heal the rows no `installation` webhook ever named: one lookup each,
    // persisted, so the repair happens once and not on every dialog open.
    const installations = await Promise.all(listed.map(withAccount));
    // `?slim=1` — the store rows bare, for callers that only need which repos
    // are connected (the connect dialog, on every open). The enrichment below
    // reads a baseline, a corpus and a decisions file PER REPO, which is
    // megabytes of JSON on a workspace with real repos.
    if (req.query.slim === '1') {
      const slim: GithubConnectStatusResponse = {
        configured: true,
        installUrl: buildInstallUrl(orgId),
        installations: installations.map(toInstallationSummary),
        repos: repos.map((r) => toRepoSummary(r, null, 0)),
      };
      res.json(slim);
      return;
    }
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
        // The setup redirect got here before the installation webhook — or the
        // webhook URL is unreachable and it is never coming. Ask the API who
        // this installation belongs to rather than waiting for a delivery; the
        // webhook's own upsert writes the same values if it does land.
        const now = new Date().toISOString();
        const account = await lookupAccount(installationId);
        await deps.store.saveInstallation({
          installationId,
          accountLogin: account?.accountLogin ?? '',
          accountType: account?.accountType ?? '',
          workspaceOrgId: orgId,
          createdAt: now,
          updatedAt: now,
        });
      } else if (inst.workspaceOrgId == null || inst.workspaceOrgId === orgId) {
        await deps.store.linkInstallationToWorkspace(installationId, orgId);
        // A row an earlier /setup stubbed is still nameless; name it now that we
        // are here. (Carrying the fresh link, since the row above is pre-link.)
        await withAccount({ ...inst, workspaceOrgId: orgId });
      }
      // Else: the installation already belongs to another workspace — never
      // re-link it (prevents cross-tenant installation takeover).
    }
    // Land back on the connect dialog so the new installation is immediately
    // pickable.
    res.redirect(`${deps.appUrl}${deps.setupRedirectPath}`);
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
    // Nor let a workspace re-link its OWN repo: linking runs the post-link hook,
    // and for a host that clones in it that means deleting and re-cloning the
    // working copy other surfaces (and any running scan) are using right now.
    if (existing) {
      res.status(409).json({ error: 'repository is already connected' });
      return;
    }
    // A first connection, so every setting starts at its default: Code Quality
    // config and notify addresses are authored later, through the settings PATCH.
    const link: RepoLinkRecord = {
      repoFullName,
      installationId,
      workspaceOrgId: orgId,
      defaultBranch,
      blocking: typeof blocking === 'boolean' ? blocking : true,
      codeQualityBlocking: true,
      codeQualityMinSeverity: 'high',
      enabled: true,
      notifyEmails: [],
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.linkRepo(link);

    // Hand the connected repo to the host (clone, project registration, initial
    // scan). The hook is part of the link: if it fails there is nothing behind
    // the row, so drop it again and tell the caller why — a repo the UI shows as
    // connected but that nothing can act on has no retry path.
    if (deps.onRepoLinked) {
      try {
        await deps.onRepoLinked(link, deps.octokitFor(installationId));
      } catch (err) {
        await deps.store.unlinkRepo(repoFullName).catch((cleanupErr: unknown) => {
          log.error(
            `[github-app] could not roll back the link for ${repoFullName}: ${(cleanupErr as Error).message}`,
          );
        });
        const message = (err as Error).message;
        log.warn(`[github-app] connecting ${repoFullName} failed: ${message}`);
        res.status(statusOf(err)).json({ error: `could not connect ${repoFullName}: ${message}` });
        return;
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
      // Cleanup FIRST, link row second. The row is what scopes the repo to this
      // workspace, so removing it ahead of a cleanup that then fails would leave
      // the clone and its registry entry visible to every workspace, with no way
      // to disconnect them again.
      if (deps.onRepoUnlinked) {
        try {
          await deps.onRepoUnlinked(existing);
        } catch (err) {
          const message = (err as Error).message;
          log.warn(`[github-app] disconnecting ${repoFullName} failed: ${message}`);
          res.status(statusOf(err)).json({ error: message });
          return;
        }
      }
      await deps.store.unlinkRepo(repoFullName);
    }
    res.json({ ok: true });
  });

  return router;
}
