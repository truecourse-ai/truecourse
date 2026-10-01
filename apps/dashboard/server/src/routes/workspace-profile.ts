/**
 * Settings › Workspace — what this workspace says its product is.
 *
 * Profile and display preference routes over the workspace-profile seam, mounted at `/api/workspace`
 * beside the members router and BEHIND the gate. They exist in BOTH MODES on
 * purpose: hosted, a workspace states its product when it is created and edits
 * it here; local, there is one implicit workspace and no Create workspace
 * dialog at all, so this page is the only place the sentence is ever set — and
 * without it a local checkout could connect nothing.
 *
 * The sentence is not decoration. It is the whole subject the Document scan
 * attributes a document against, so saving a new one re-judges every document
 * in the workspace once (it is part of the curation cache key) — and moves the
 * workspace's changed-at stamp, so Context's Scan button shows the corpus as
 * behind until that scan runs.
 */

import { Router, type Request, type Response } from 'express';
import { markContextChanged } from '@truecourse/core/lib/context-store';
import {
  readWorkspaceProfile,
  saveWorkspaceProfile,
  setWorkspaceShowBlocked,
} from '@truecourse/core/lib/workspace-profile-store';
import {
  BAD_WORKSPACE_DESCRIPTION,
  normalizeWorkspaceDescription,
  type WorkspaceProfileResponse,
} from '@truecourse/shared';

export function createWorkspaceProfileRouter(): Router {
  const router: Router = Router();

  router.get('/profile', async (req: Request, res: Response) => {
    const org = req.user?.organizationId;
    if (!org) {
      res.status(403).json({ error: 'This session has no workspace.' });
      return;
    }
    const profile = await readWorkspaceProfile(org);
    const body: WorkspaceProfileResponse = {
      showBlocked: profile?.showBlocked ?? false,
      description: profile?.description ?? null,
      updatedAt: profile?.updatedAt ?? null,
    };
    res.json(body);
  });

  router.put('/profile', async (req: Request, res: Response) => {
    const org = req.user?.organizationId;
    if (!org) {
      res.status(403).json({ error: 'This session has no workspace.' });
      return;
    }
    const description = normalizeWorkspaceDescription((req.body as { description?: unknown })?.description);
    if (!description) {
      res.status(400).json({ error: BAD_WORKSPACE_DESCRIPTION });
      return;
    }
    const saved = await saveWorkspaceProfile(org, description);
    // Every kept/skipped verdict was formed against the old sentence: the
    // corpus is stale from this moment, whatever else changed.
    await markContextChanged(org, saved.updatedAt);
    const body: WorkspaceProfileResponse = {
      showBlocked: saved.showBlocked ?? false,
      description: saved.description,
      updatedAt: saved.updatedAt,
    };
    res.json(body);
  });

  router.put('/display', async (req: Request, res: Response) => {
    const org = req.user?.organizationId;
    if (!org) {
      res.status(403).json({ error: 'This session has no workspace.' });
      return;
    }
    const showBlocked = (req.body as { showBlocked?: unknown })?.showBlocked;
    if (typeof showBlocked !== 'boolean') {
      res.status(400).json({ error: 'showBlocked must be a boolean.' });
      return;
    }
    const profile = await setWorkspaceShowBlocked(org, showBlocked);
    if (!profile) {
      res.status(409).json({ error: 'Describe this workspace before changing display preferences.' });
      return;
    }
    res.json({ description: profile.description, updatedAt: profile.updatedAt, showBlocked: profile.showBlocked ?? false } satisfies WorkspaceProfileResponse);
  });

  return router;
}
