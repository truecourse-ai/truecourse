/**
 * Workspace data endpoints (enterprise, protected by the OSS auth gate).
 *
 * Scoped to the signed-in user's WorkOS organization (read from the session the
 * gate resolved). Surfaces the org's SSO connection status and member list.
 */

import { Router } from 'express';
import type { Request } from 'express';
import { WorkOS } from '@workos-inc/node';
import type {
  AuthUser,
  SsoStatusResponse,
  EeWorkspaceMembersResponse,
} from '@truecourse/shared';

// The OSS auth gate attaches the resolved user; read it without
// depending on the OSS type augmentation.
function orgIdOf(req: Request): string | null {
  const user = (req as Request & { user?: AuthUser }).user;
  return user?.organizationId ?? null;
}

export function createWorkspaceRouter(workos: WorkOS): Router {
  const router = Router();

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

  router.get('/members', async (req, res) => {
    const organizationId = orgIdOf(req);
    if (!organizationId) {
      const empty: EeWorkspaceMembersResponse = { members: [] };
      res.json(empty);
      return;
    }
    try {
      const list = await workos.userManagement.listUsers({ organizationId });
      const body: EeWorkspaceMembersResponse = {
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
