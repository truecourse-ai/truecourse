/**
 * Connect router (protected — behind the enterprise auth gate). Powers the
 * dashboard's GitHub integration page: install URL, post-install linking,
 * connecting repos to the gate, and run history. Everything is scoped to the
 * authenticated user's workspace (WorkOS org).
 */

import { Router, type Request, type Response } from 'express';
import { registerProject } from '@truecourse/core/config/registry';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallationSummary,
  GithubRepoSummary,
  GithubRunSummary,
} from '@truecourse/shared';
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

function toRepoSummary(r: RepoLinkRecord): GithubRepoSummary {
  return {
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    defaultBranch: r.defaultBranch,
    blocking: r.blocking,
    enabled: r.enabled,
    notifyEmails: r.notifyEmails ?? [],
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
    const body: GithubConnectStatusResponse = {
      configured: true,
      installUrl: buildInstallUrl(orgId),
      installations: installations.map(toInstallationSummary),
      repos: repos.map(toRepoSummary),
    };
    res.json(body);
  });

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
    res.redirect(`${deps.appUrl}/integrations/github`);
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
      enabled: true,
      notifyEmails: existing?.notifyEmails ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    // Surface the connected repo in the dashboard's project list immediately
    // (keyed by `owner/repo`, deterministic slug). The first default-branch
    // merge then fills in its analysis.
    await registerProject(repoFullName, repoFullName);
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
    await deps.store.linkRepo({
      ...existing,
      blocking:
        typeof body.blocking === 'boolean' ? body.blocking : existing.blocking,
      enabled:
        typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      notifyEmails,
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

  return router;
}
