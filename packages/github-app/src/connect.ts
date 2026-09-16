/**
 * Connect router (protected — mounted behind the host's auth gate). Powers the
 * dashboard's GitHub integration page: the connect URL, the App's OAuth
 * callback, and connecting repos. Everything is scoped to the authenticated
 * user's workspace.
 *
 * ONE door in: Connect sends the browser to GitHub's authorize page with a
 * signed `state`; GitHub comes back to the App's Callback URL with a code,
 * and the callback attaches every installation of ours the person can reach
 * to the workspace — or sends them on to install when there is none. An
 * install returns to the same callback, with the installation id beside the
 * code. Two workspaces can attach the same installation this way (GitHub
 * allows one installation per account); a REPOSITORY still belongs to one.
 *
 * WHAT happens to a repo once it is connected — or once it is disconnected — is
 * not this router's business: it hands the link to
 * {@link ConnectDeps.onRepoLinked} / {@link ConnectDeps.onRepoUnlinked}. WHETHER
 * it happened is: both hooks are transactional, so the link row and the work
 * behind it are never out of step (see the two hook types).
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import {
  GITHUB_INSTALL_ORIGINS,
  type GithubInstallOrigin,
} from '@truecourse/shared';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
  GithubInstallationSummary,
  GithubRepoSummary,
  RepositoryLink,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import type { OctokitClient } from './octokit.js';
import { resolveNotificationPrefs } from './notifications.js';
import { GITHUB_PROVIDER, installationOf } from './provider.js';
import type { UserInstallation } from './oauth.js';
import {
  CONNECT_STATE_TTL_MS,
  signConnectState,
  verifyConnectState,
} from './connect-state.js';
import type { InstallationStore, InstallationRecord } from './store/types.js';

function userOf(req: Request): AuthUser | null {
  return (req as Request & { user?: AuthUser }).user ?? null;
}

function orgIdOf(req: Request): string | null {
  return userOf(req)?.organizationId ?? null;
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

function toRepoSummary(r: RepositoryRecord): GithubRepoSummary {
  return {
    repoFullName: r.repoFullName,
    installationId: installationOf(r) ?? 0,
    defaultBranch: r.defaultBranch ?? '',
    blocking: r.blocking,
    enabled: r.enabled,
    notifyEmails: r.notifyEmails ?? [],
    notifications: resolveNotificationPrefs(r),
    slug: r.slug,
  };
}

/**
 * Follow-up work on a freshly connected repo — enqueuing its first Context sync
 * and Flow setup, whatever the host wires up. Runs after the link is persisted,
 * with an installation-scoped client for the repo's own installation.
 *
 * PART OF THE LINK: a hook that throws rolls the link back, because a link row
 * with none of that work behind it is a repo the UI calls connected and nothing
 * can act on.
 */
export type OnRepoLinked = (
  link: RepositoryRecord,
  octokit: OctokitClient,
) => Promise<void>;

/**
 * Cleanup for a repo the user is disconnecting — cancelling its in-flight work
 * and purging its rows. Runs BEFORE the link is removed, so everything it
 * touches is still owned by exactly one workspace while it works; a hook that
 * throws leaves the link intact and fails the request, since state that
 * outlives its link row is scoped to nobody.
 */
export type OnRepoUnlinked = (link: RepositoryRecord) => Promise<void>;

export interface ConnectDeps {
  store: InstallationStore;
  /** The connected repositories, whichever provider brought them. */
  repos: RepositoryStore;
  appSlug: string;
  /** The App's OAuth client id, for the authorize URL. */
  clientId: string;
  /** Signs the `state` a trip to GitHub carries; the server's own secret. */
  stateSecret: string;
  /** Dashboard client origin, for browser-facing redirects (the callback's landing). */
  appUrl: string;
  /**
   * Where the callback lands, relative to {@link appUrl} — the host's own
   * connect surface, since the two dashboards that mount this router route it
   * differently.
   */
  setupRedirectPath: string;
  /**
   * Where the callback lands instead when the trip was started from a named
   * place (the origin rides the signed `state`): a host that has such places
   * names them here, one path each. An origin with no path here lands on
   * {@link setupRedirectPath}.
   */
  setupRedirectPaths?: Partial<Record<GithubInstallOrigin, string>>;
  /** Installation-scoped GitHub client, for listing the repos a user can connect. */
  octokitFor: (installationId: number) => OctokitClient;
  /**
   * The installations of this App the person behind an OAuth code can reach:
   * the code exchanged for a user token, the token asked once, then dropped.
   * A throw (a stale or replayed code, GitHub down) refuses the callback.
   */
  userInstallationsFor: (code: string) => Promise<UserInstallation[]>;
  /**
   * Who an installation belongs to, read from the App API (app-level auth), to
   * name a row an earlier version left nameless. Best-effort — a null (or a
   * throw) leaves the record as it is, and the UI shows the installation id.
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

/** The query flag the callback lands with when it could not attach anything. */
export const CONNECT_REFUSED_FLAG = 'github=refused';

export function createConnectRouter(deps: ConnectDeps): Router {
  const router = Router();

  const originOf = (raw: unknown): GithubInstallOrigin | null =>
    typeof raw === 'string' && (GITHUB_INSTALL_ORIGINS as readonly string[]).includes(raw)
      ? (raw as GithubInstallOrigin)
      : null;

  const stateFor = (user: AuthUser, orgId: string, origin: GithubInstallOrigin | null): string =>
    signConnectState(
      { orgId, userId: user.id, origin, expiresAt: Date.now() + CONNECT_STATE_TTL_MS },
      deps.stateSecret,
    );

  // Connect: authorize with GitHub, which is what tells us the installations
  // this person can reach. The App's registered Callback URL is where GitHub
  // returns, so no redirect_uri travels.
  const buildConnectUrl = (state: string): string =>
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      deps.clientId,
    )}&state=${encodeURIComponent(state)}`;

  // Install on a GitHub account that does not have the App yet. With user
  // authorization on, GitHub returns to the same callback with a code.
  const buildInstallUrl = (state: string): string =>
    `https://github.com/apps/${deps.appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  /** Where a trip that started at `origin` lands, as an absolute URL. */
  const landing = (origin: GithubInstallOrigin | null, flag?: string): string => {
    const path = (origin && deps.setupRedirectPaths?.[origin]) ?? deps.setupRedirectPath;
    if (!flag) return `${deps.appUrl}${path}`;
    return `${deps.appUrl}${path}${path.includes('?') ? '&' : '?'}${flag}`;
  };

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
   * Name an installation nothing ever named, and persist it, so a nameless row
   * stops rendering as `#<id>` from the next read on. Returns the record to
   * render — the healed one when the lookup answered.
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

  /** An installation this workspace may list and connect from. */
  const heldBy = async (installationId: number, orgId: string): Promise<InstallationRecord | null> => {
    const inst = await deps.store.getInstallation(installationId);
    return inst && inst.workspaceOrgIds.includes(orgId) ? inst : null;
  };

  router.get('/status', async (req: Request, res: Response) => {
    const user = userOf(req);
    const orgId = user?.organizationId ?? null;
    if (!user || !orgId) {
      const empty: GithubConnectStatusResponse = {
        configured: true,
        connectUrl: '',
        installUrl: '',
        installations: [],
        repos: [],
      };
      res.json(empty);
      return;
    }
    const [listed, connected] = await Promise.all([
      deps.store.listInstallationsForWorkspace(orgId),
      deps.repos.listReposForWorkspace(orgId),
    ]);
    // This surface is the App's: a repository connected through another
    // provider is not one of its installations' and is not listed here.
    const repos = connected.filter((r) => r.provider === GITHUB_PROVIDER);
    // Self-heal the rows nothing ever named: one lookup each, persisted, so
    // the repair happens once and not on every dialog open.
    const installations = await Promise.all(listed.map(withAccount));
    const state = stateFor(user, orgId, originOf(req.query.from));
    const body: GithubConnectStatusResponse = {
      configured: true,
      connectUrl: buildConnectUrl(state),
      installUrl: buildInstallUrl(state),
      installations: installations.map(toInstallationSummary),
      repos: repos.map(toRepoSummary),
    };
    res.json(body);
  });

  // Repos the installation can access — populates the connect drawer's repo
  // picker (so users choose from a list instead of typing `owner/name`). A
  // repo another workspace already connected is listed but flagged: the
  // picker shows why it cannot be picked here instead of a 409 after the click.
  router.get(
    '/installations/:installationId/repos',
    async (req: Request, res: Response) => {
      const orgId = orgIdOf(req);
      const installationId = Number(req.params.installationId);
      if (!orgId || !Number.isInteger(installationId)) {
        res.status(400).json({ error: 'installationId required' });
        return;
      }
      // Ownership: only list repos for an installation attached to the caller's workspace.
      if (!(await heldBy(installationId, orgId))) {
        res.status(403).json({ error: 'installation not in your workspace' });
        return;
      }
      try {
        const octokit = deps.octokitFor(installationId);
        const [repos, connected] = await Promise.all([
          octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 }),
          deps.repos.listReposForAccount(GITHUB_PROVIDER, String(installationId)),
        ]);
        const elsewhere = new Set(
          connected.filter((r) => r.workspaceOrgId !== orgId).map((r) => r.repoFullName),
        );
        const body: GithubInstallationReposResponse = {
          repos: repos.map(
            (r): GithubInstallableRepo => ({
              fullName: r.full_name,
              defaultBranch: r.default_branch,
              private: r.private,
              connectedElsewhere: elsewhere.has(r.full_name),
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

  // The App's Callback URL: GitHub sends the browser here with `code` and our
  // `state` — after an install (`installation_id` beside them) or after a
  // plain authorize. The state binds the trip to the session that started
  // it; the code says which installations the person can reach; every one of
  // them is attached to the workspace. Nothing to attach means the person has
  // no installation of ours yet, so they go on to install.
  router.get('/callback', async (req: Request, res: Response) => {
    const user = userOf(req);
    const orgId = user?.organizationId ?? null;
    const rawState = typeof req.query.state === 'string' ? req.query.state : undefined;
    const state = verifyConnectState(rawState, deps.stateSecret);
    const origin = state?.origin ?? null;
    const refuse = (why: string): void => {
      log.warn(`[github] connect callback refused: ${why}`);
      res.redirect(landing(origin, CONNECT_REFUSED_FLAG));
    };

    if (!user || !orgId) {
      refuse('no workspace on the session');
      return;
    }
    if (!state || state.orgId !== orgId || state.userId !== user.id) {
      refuse(state ? 'state belongs to another session' : 'state missing, expired or unsigned');
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) {
      refuse('no code');
      return;
    }
    const rawInstallation = req.query.installation_id;
    const installedId = typeof rawInstallation === 'string' ? Number(rawInstallation) : null;

    let reachable: UserInstallation[];
    try {
      reachable = await deps.userInstallationsFor(code);
    } catch (err) {
      refuse((err as Error).message);
      return;
    }
    if (installedId !== null && !reachable.some((i) => i.installationId === installedId)) {
      refuse(`installation ${installedId} is not one the person can reach`);
      return;
    }
    if (reachable.length === 0) {
      // Authorized, but the App is installed nowhere this person can reach:
      // on to GitHub's install page, which returns here with the new one.
      res.redirect(buildInstallUrl(stateFor(user, orgId, origin)));
      return;
    }

    const now = new Date().toISOString();
    for (const installation of reachable) {
      const existing = await deps.store.getInstallation(installation.installationId);
      await deps.store.saveInstallation({
        installationId: installation.installationId,
        accountLogin: installation.accountLogin || existing?.accountLogin || '',
        accountType: installation.accountType || existing?.accountType || '',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await deps.store.linkInstallationToWorkspace(installation.installationId, orgId);
    }
    log.info(
      `[github] ${reachable.length} installation(s) attached to workspace ${orgId}: ${reachable
        .map((i) => i.accountLogin || `#${i.installationId}`)
        .join(', ')}`,
    );
    // Land back where the trip started, so the installations are pickable at once.
    res.redirect(landing(origin));
  });

  // Detach an installation from THIS workspace: its repositories connected
  // here are disconnected first (cleanup before the row, as an explicit unlink
  // does), then the link goes. Other workspaces' links and repositories, and
  // the installation itself on GitHub, are untouched.
  router.delete('/installations/:installationId', async (req: Request, res: Response) => {
    const orgId = orgIdOf(req);
    const installationId = Number(req.params.installationId);
    if (!orgId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!Number.isInteger(installationId)) {
      res.status(400).json({ error: 'installationId required' });
      return;
    }
    if (!(await heldBy(installationId, orgId))) {
      res.status(403).json({ error: 'installation not in your workspace' });
      return;
    }
    const mine = (
      await deps.repos.listReposForAccount(GITHUB_PROVIDER, String(installationId))
    ).filter((r) => r.workspaceOrgId === orgId);
    for (const link of mine) {
      if (deps.onRepoUnlinked) {
        try {
          await deps.onRepoUnlinked(link);
        } catch (err) {
          const message = (err as Error).message;
          log.warn(`[github-app] disconnecting ${link.repoFullName} failed: ${message}`);
          res.status(statusOf(err)).json({ error: message });
          return;
        }
      }
      await deps.repos.unlinkRepo(link.repoFullName);
    }
    await deps.store.unlinkInstallationFromWorkspace(installationId, orgId);
    log.info(
      `[github] installation ${installationId} detached from workspace ${orgId} (${mine.length} repositor${mine.length === 1 ? 'y' : 'ies'} disconnected)`,
    );
    res.json({ ok: true, disconnected: mine.map((r) => r.repoFullName) });
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
    // Ownership: the installation must be attached to this workspace.
    if (!(await heldBy(installationId, orgId))) {
      res.status(403).json({ error: 'installation not in your workspace' });
      return;
    }
    const now = new Date().toISOString();
    const existing = await deps.repos.getRepo(repoFullName);
    // Repos are keyed globally by full name; never let one workspace overwrite
    // a repo another workspace already connected.
    if (existing && existing.workspaceOrgId !== orgId) {
      res
        .status(409)
        .json({ error: 'repository already connected to another workspace' });
      return;
    }
    // Nor let a workspace re-link its OWN repo: linking runs the post-link
    // hook, which would start a second onboarding over the work already in
    // flight.
    if (existing) {
      res.status(409).json({ error: 'repository is already connected' });
      return;
    }
    // A first connection, so every setting starts at its default: the notify
    // addresses are authored later, through the settings PATCH.
    const link: RepositoryLink = {
      repoFullName,
      provider: GITHUB_PROVIDER,
      accountId: String(installationId),
      workspaceOrgId: orgId,
      defaultBranch,
      blocking: typeof blocking === 'boolean' ? blocking : true,
      enabled: true,
      notifyEmails: [],
      createdAt: now,
      updatedAt: now,
    };
    const stored = await deps.repos.linkRepo(link);

    // Hand the connected repo to the host (its setup). The hook is part of the
    // link: if it fails there is nothing behind the row, so drop it again and
    // tell the caller why — a repo the UI shows as connected but that nothing
    // can act on has no retry path.
    if (deps.onRepoLinked) {
      try {
        await deps.onRepoLinked(stored, deps.octokitFor(installationId));
      } catch (err) {
        await deps.repos.unlinkRepo(repoFullName).catch((cleanupErr: unknown) => {
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
    const existing = await deps.repos.getRepo(repoFullName);
    if (existing && existing.workspaceOrgId === orgId) {
      // This door is the App's: a repository another provider connected is not
      // one of its, however the request names it.
      if (existing.provider !== GITHUB_PROVIDER) {
        res.status(404).json({ error: `${repoFullName} is not a GitHub repository` });
        return;
      }
      // Cleanup FIRST, link row second. The row is what scopes the repo to this
      // workspace, so removing it ahead of a cleanup that then fails would leave
      // the repo's rows — runs, scenario sets, Context links — behind with no
      // link scoping them to a workspace.
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
      await deps.repos.unlinkRepo(repoFullName);
    }
    res.json({ ok: true });
  });

  return router;
}
