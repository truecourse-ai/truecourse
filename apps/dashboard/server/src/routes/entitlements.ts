/**
 * ENTITLEMENTS, as the operator's console:
 *
 *   GET    /api/operator/entitlements          every workspace and what it holds
 *   POST   /api/operator/entitlements/grant    hand a workspace one feature
 *   POST   /api/operator/entitlements/revoke   take one back
 *
 * TrueCourse staff only, and a caller who is not one is told there is NO SUCH
 * ROUTE rather than that they may not have it — the same rule the credits
 * console runs on, and the two mount together.
 *
 * It does not mount in local mode: one developer on one machine has no operator
 * to grant anything and already holds everything the bundle carries (see
 * `app.ts` and `services/entitlements.service.ts`).
 *
 * A REVOKE also PAUSES the workspace's sources that read through the feature,
 * with the reason on each, exactly as removing the connection itself does. The
 * documents stay, so a grant restored later is a Resume rather than a re-add.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ENTERPRISE_FEATURES,
  type OperatorEntitlementMovementResponse,
  type OperatorEntitlementsResponse,
} from '@truecourse/shared';
import { operatorOnly } from '../middleware/operator.js';
import {
  entitlementWorkspaces,
  grantWorkspaceFeature,
  revokeWorkspaceFeature,
} from '../services/entitlements.service.js';
import { captureAction, EVENTS } from '../observability/posthog.js';
import {
  resolveWorkspaceName,
  type WorkspaceNameLookup,
} from '../services/workspace-name.service.js';

const movementSchema = z.object({
  workspaceOrgId: z.string().min(1).max(200),
  feature: z.enum(ENTERPRISE_FEATURES),
  note: z.string().max(500).optional(),
});

export interface OperatorEntitlementsRouterOptions {
  /** An organization's display name; absent on a server with no identity provider. */
  workspaceName?: WorkspaceNameLookup;
}

export function createOperatorEntitlementsRouter(
  opts: OperatorEntitlementsRouterOptions = {},
): Router {
  const router: Router = Router();
  router.use(operatorOnly);

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await entitlementWorkspaces();
      const body: OperatorEntitlementsResponse = {
        workspaces: await Promise.all(
          rows.map(async (row) => ({
            workspaceOrgId: row.workspaceOrgId,
            workspaceName: await resolveWorkspaceName(opts.workspaceName, row.workspaceOrgId),
            features: row.features,
          })),
        ),
      };
      res.json(body);
    } catch (e) {
      next(e);
    }
  });

  router.post('/grant', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = movementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid grant', details: parsed.error.flatten() });
        return;
      }
      const { workspaceOrgId, feature, note } = parsed.data;
      const features = await grantWorkspaceFeature({
        workspaceOrgId,
        feature,
        actorUserId: req.user!.id,
        ...(note ? { note } : {}),
      });
      // The workspace the feature was handed TO is the one this happened in;
      // the operator is the person behind it.
      captureAction(EVENTS.entitlementGranted, {
        userId: req.user!.id,
        workspaceId: workspaceOrgId,
        properties: { feature },
      });
      const body: OperatorEntitlementMovementResponse = { workspaceOrgId, features };
      res.json(body);
    } catch (e) {
      next(e);
    }
  });

  router.post('/revoke', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = movementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid revoke', details: parsed.error.flatten() });
        return;
      }
      const { workspaceOrgId, feature } = parsed.data;
      const { revoked, features, paused } = await revokeWorkspaceFeature({
        workspaceOrgId,
        feature,
      });
      // Revoking what a workspace never held changes nothing, so it reports
      // nothing: the answer is the same either way.
      if (revoked) {
        captureAction(EVENTS.entitlementRevoked, {
          userId: req.user!.id,
          workspaceId: workspaceOrgId,
          properties: { feature, pausedSources: paused.length },
        });
      }
      const body: OperatorEntitlementMovementResponse = { workspaceOrgId, features, paused };
      res.json(body);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
