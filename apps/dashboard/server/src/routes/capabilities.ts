/**
 * GET /api/capabilities
 *
 * How this server RUNS, and nothing else. Public (mounted before the auth
 * gate), because it is the one thing the client cannot know for itself before
 * it has a session: a local server has no sign-in and offers the folder on this
 * machine as a repository, and the sign-in screen itself differs because of it.
 *
 * What a caller MAY USE is not here. That is a fact about a workspace rather
 * than about the deployment — the same hosted server opens Atlassian to one
 * customer and keeps it closed for the next — so it rides the authenticated
 * answer (`GET /api/auth/me`), where there is a workspace to answer for. One
 * source, so the two can never disagree.
 */

import { Router } from 'express';
import type { CapabilitiesResponse } from '@truecourse/shared';
import { serverMode } from '../mode.js';

const router: Router = Router();

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = { mode: serverMode() };
  res.json(body);
});

export default router;
