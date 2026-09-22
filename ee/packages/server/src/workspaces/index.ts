/**
 * More than one workspace.
 *
 * The open edition has exactly one: a session is minted into the organization
 * its user belongs to and stays there. These three routes are what a second one
 * needs — the list the switcher draws, the move into another, and the creation
 * of one more — and they mount at `/api/auth/workspaces`, above the auth gate,
 * because each mints a cookie of its own off the sealed session rather than
 * reading the one the gate resolved.
 *
 * Creating the FIRST workspace is not here: an org-less signup naming its
 * workspace is onboarding, which every edition has.
 */

import { Router } from 'express';
import type { ServerFeature, WorkspaceSessionTools } from '@truecourse/dashboard-server';
import type { WorkspaceSummary, WorkspacesResponse } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { saveWorkspaceProfile } from '@truecourse/core/lib/workspace-profile-store';
import {
  BAD_WORKSPACE_DESCRIPTION,
  normalizeWorkspaceDescription,
} from '@truecourse/shared';

/** A workspace name as it may be stored, or null when it is not one. */
function workspaceNameOf(body: unknown): string | null {
  const raw = (body as { name?: unknown })?.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name && name.length <= 80 ? name : null;
}

const BAD_WORKSPACE_NAME = 'A workspace name of 1 to 80 characters is required.';

export function createWorkspacesRouter(tools: WorkspaceSessionTools): Router {
  const router: Router = Router();

  // The workspaces the signed-in user can be in: their active memberships, with
  // the one the session is minted into marked. The side menu's switcher is this
  // list.
  router.get('/', async (req, res) => {
    try {
      const session = await tools.requireSession(req, res);
      if (!session) return;
      const memberships = await tools.activeMemberships(session.user.id);
      const workspaces: WorkspaceSummary[] = await Promise.all(
        memberships.map(async (m) => ({
          id: m.organizationId,
          // The cache `/me` fills: the current workspace is already in it, and
          // every other is looked up once and kept for the life of the process.
          // The membership's own name stands in when the lookup is refused.
          name: (await tools.organizationName(m.organizationId)) ?? m.organizationName,
          current: m.organizationId === session.organizationId,
        })),
      );
      const body: WorkspacesResponse = { workspaces };
      res.json(body);
    } catch (err) {
      const message = (err as Error).message;
      log.error(`[Workspaces] listing failed: ${message}`);
      res.status(502).json({ error: message });
    }
  });

  // Create a workspace and go into it. Unlike onboarding's `/api/auth/workspace`,
  // this ALWAYS creates: it is reached from the switcher by someone who already
  // has one and wants another.
  //
  // It is named AND DESCRIBED here. The description is what every document the
  // workspace ever holds is attributed against, and a workspace without one can
  // connect nothing, so it is collected where the workspace begins rather than
  // asked for later at the first refusal.
  router.post('/', async (req, res) => {
    const name = workspaceNameOf(req.body);
    if (!name) {
      res.status(400).json({ error: BAD_WORKSPACE_NAME });
      return;
    }
    const description = normalizeWorkspaceDescription(
      (req.body as { description?: unknown })?.description,
    );
    if (!description) {
      res.status(400).json({ error: BAD_WORKSPACE_DESCRIPTION });
      return;
    }
    try {
      const session = await tools.requireSession(req, res);
      if (!session) return;
      const org = await tools.workos.organizations.createOrganization({ name });
      await tools.workos.userManagement.createOrganizationMembership({
        organizationId: org.id,
        userId: session.user.id,
      });
      await saveWorkspaceProfile(org.id, description);
      const minted = await tools.mintSessionInto(session.sealed, org.id);
      // The name is the one just typed, so nothing looks it up.
      tools.rememberOrganizationName(org.id, org.name);
      res.setHeader('Set-Cookie', minted.setCookie);
      res.json({ user: tools.toAuthUser(minted.user, minted.organizationId, org.name) });
    } catch (err) {
      res.status(500).json({ error: `Could not create workspace: ${(err as Error).message}` });
    }
  });

  // Switch the session into another of the user's workspaces. Only one they are
  // really in: an organization they have no active membership of is not theirs
  // to enter, so it reads as absent.
  router.post('/switch', async (req, res) => {
    const raw = (req.body as { organizationId?: unknown })?.organizationId;
    const organizationId = typeof raw === 'string' ? raw.trim() : '';
    if (!organizationId) {
      res.status(400).json({ error: 'A workspace is required.' });
      return;
    }
    try {
      const session = await tools.requireSession(req, res);
      if (!session) return;
      const membership = (await tools.activeMemberships(session.user.id)).find(
        (m) => m.organizationId === organizationId,
      );
      if (!membership) {
        res.status(404).json({ error: 'No such workspace.' });
        return;
      }
      const minted = await tools.mintSessionInto(session.sealed, organizationId);
      tools.rememberOrganizationName(organizationId, membership.organizationName);
      res.setHeader('Set-Cookie', minted.setCookie);
      res.json({
        user: tools.toAuthUser(minted.user, minted.organizationId, membership.organizationName),
      });
    } catch (err) {
      const message = (err as Error).message;
      log.error(`[Workspaces] switching into ${organizationId} failed: ${message}`);
      res.status(502).json({ error: message });
    }
  });

  return router;
}

export const workspacesFeature: ServerFeature = {
  name: 'multiple workspaces',
  manyWorkspaces: true,
  // A session moves between workspaces through the identity provider, so a
  // server that has none — one machine, one implicit workspace — mounts
  // nothing rather than offering a switch that cannot happen.
  mount: ({ workspaceSession }) =>
    workspaceSession
      ? [
          {
            path: '/api/auth/workspaces',
            router: createWorkspacesRouter(workspaceSession),
            public: true,
          },
        ]
      : [],
};
