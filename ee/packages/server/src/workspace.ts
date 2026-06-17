/**
 * Workspace data endpoints (enterprise, protected by the OSS auth gate).
 *
 * Scoped to the signed-in user's WorkOS organization (read from the
 * session the gate resolved). Surfaces the org's SSO connection status
 * and member list for the Workspace page.
 */

import { Router } from 'express';
import type { Request } from 'express';
import { WorkOS } from '@workos-inc/node';
import type {
  AuthUser,
  SeverityCounts,
  SsoStatusResponse,
  WorkspaceMembersResponse,
  WorkspaceOverviewResponse,
  WorkspaceSettingsResponse,
} from '@truecourse/shared';
import { slugify } from '@truecourse/core/config/registry';
import { listViolations } from '@truecourse/core/services/violation-query';
import { readVerifyState } from '@truecourse/core/commands/spec-in-process';

// A repo counts as stale if it was never analyzed/scanned or not within this window.
const STALE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Per-repo readers the overview aggregates over, injectable so the route is
// unit-testable without touching the real stores.
export interface WorkspaceDataReaders {
  listViolations: typeof listViolations;
  readVerifyState: typeof readVerifyState;
}

const defaultReaders: WorkspaceDataReaders = {
  listViolations,
  readVerifyState,
};

/**
 * The repo identities (repoKeys) connected to a workspace — the gate's `gh_repos`,
 * scoped per org. This is what makes the overview workspace-isolated (vs the old
 * global registry, which leaked repos across workspaces). Injected by the server
 * (backed by the gate store) and stubbed in tests.
 */
export type ReposForWorkspace = (orgId: string) => Promise<string[]>;

/** Minimal workspace-settings store the settings routes need — the concrete
 *  `WorkspaceSettingsStore` satisfies it structurally; tests stub it. */
export interface WorkspaceSettingsReader {
  get(orgId: string): Promise<{ codeAnalysisLlm: boolean }>;
  setCodeAnalysisLlm(orgId: string, enabled: boolean): Promise<void>;
}

// The OSS auth gate attaches the resolved user; read it without
// depending on the OSS type augmentation.
function orgIdOf(req: Request): string | null {
  const user = (req as Request & { eeUser?: AuthUser }).eeUser;
  return user?.organizationId ?? null;
}

export function createWorkspaceRouter(
  workos: WorkOS,
  reposForWorkspace: ReposForWorkspace,
  settings: WorkspaceSettingsReader,
  readers: WorkspaceDataReaders = defaultReaders,
): Router {
  const router = Router();

  // Per-workspace feature settings (currently the LLM code-analysis toggle).
  router.get('/settings', async (req, res) => {
    const orgId = orgIdOf(req);
    const codeAnalysisLlm = orgId ? (await settings.get(orgId)).codeAnalysisLlm : false;
    res.json({ codeAnalysisLlm } satisfies WorkspaceSettingsResponse);
  });

  router.patch('/settings', async (req, res) => {
    const orgId = orgIdOf(req);
    if (!orgId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const next = (req.body as Partial<WorkspaceSettingsResponse> | undefined)?.codeAnalysisLlm;
    if (typeof next !== 'boolean') {
      res.status(400).json({ error: 'codeAnalysisLlm (boolean) is required' });
      return;
    }
    await settings.setCodeAnalysisLlm(orgId, next);
    res.json({ codeAnalysisLlm: next } satisfies WorkspaceSettingsResponse);
  });

  router.get('/sso-status', async (req, res) => {
    const organizationId = orgIdOf(req);
    if (!organizationId) {
      const empty: SsoStatusResponse = { configured: false, connections: [] };
      res.json(empty);
      return;
    }
    try {
      const list = await workos.sso.listConnections({ organizationId });
      const body: SsoStatusResponse = {
        configured: list.data.length > 0,
        connections: list.data.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          state: c.state,
        })),
      };
      res.json(body);
    } catch {
      res.status(502).json({ error: 'Failed to load SSO status from WorkOS' });
    }
  });

  // Workspace home dashboard: aggregate repo/analysis stats (from the
  // local registry via core) + member/org info (from WorkOS) in one
  // call. Repo data is the locally-analyzed set today; the GitHub-
  // connected source replaces it when that integration lands.
  router.get('/overview', async (req, res) => {
    const severity: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let violationCount = 0;
    let driftCount = 0;
    let staleCount = 0;
    const now = Date.now();

    // Repos connected to THIS workspace (the gate's gh_repos) — not a global
    // list — so the overview is workspace-isolated and matches the Repositories
    // page. Each repo is keyed by its full name (repoKey); the slug is derived.
    const organizationId = orgIdOf(req);
    const repoKeys = organizationId ? await reposForWorkspace(organizationId) : [];
    const repos = await Promise.all(repoKeys.map(async (repoKey) => {
      let v = 0;
      let d = 0;
      let lastAnalyzed: string | null = null;
      try {
        const { violations } = await readers.listViolations(repoKey, { status: 'active' });
        v = violations.length;
        for (const vi of violations) severity[vi.severity] += 1;
      } catch {
        // unanalyzed / unreadable repo — counts stay 0
      }
      try {
        const vstate = await readers.readVerifyState(repoKey);
        d = vstate?.drifts.length ?? 0;
        lastAnalyzed = vstate?.verifiedAt ?? null;
      } catch {
        // no verify run recorded
      }
      violationCount += v;
      driftCount += d;
      const stale = !lastAnalyzed || now - Date.parse(lastAnalyzed) > STALE_WINDOW_MS;
      if (stale) staleCount += 1;
      return { id: slugify(repoKey, []), name: repoKey, lastAnalyzed, violations: v, drift: d };
    }));

    // Org name from WorkOS (best-effort — repo stats still render if
    // WorkOS is briefly unavailable). Members live on the Workspace page.
    let organizationName: string | null = null;
    if (organizationId) {
      try {
        organizationName = (
          await workos.organizations.getOrganization(organizationId)
        ).name;
      } catch {
        /* ignore */
      }
    }

    const body: WorkspaceOverviewResponse = {
      organizationName,
      stats: {
        repoCount: repoKeys.length,
        violationCount,
        driftCount,
        staleCount,
        severity,
      },
      repos,
    };
    res.json(body);
  });

  router.get('/members', async (req, res) => {
    const organizationId = orgIdOf(req);
    if (!organizationId) {
      const empty: WorkspaceMembersResponse = { members: [] };
      res.json(empty);
      return;
    }
    try {
      const list = await workos.userManagement.listUsers({ organizationId });
      const body: WorkspaceMembersResponse = {
        members: list.data.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
        })),
      };
      res.json(body);
    } catch {
      res.status(502).json({ error: 'Failed to load members from WorkOS' });
    }
  });

  return router;
}
