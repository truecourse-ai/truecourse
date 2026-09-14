/**
 * GET /api/capabilities
 *
 * Reports which feature gates are on. Public (mounted before the auth gate) so
 * the client can read them before authenticating.
 *
 * `edition` is the constant `'community'`: there is one product, and which
 * edition a deployment runs is decided when its bundle is built, not answered
 * over the wire. The field stays because the client still reads it.
 *
 * `mode` is the one thing here the client cannot know for itself: a local
 * server has no sign-in and offers the folder on this machine as a repository,
 * and this is where it says so — before the client has a session, which is why
 * it rides the public endpoint rather than `/api/auth/me`.
 */

import { Router } from 'express';
import type { CapabilitiesResponse } from '@truecourse/shared';
import { getCapabilities } from '../capabilities.js';
import { serverMode } from '../mode.js';

const router: Router = Router();

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = {
    edition: 'community',
    mode: serverMode(),
    capabilities: getCapabilities(),
  };
  res.json(body);
});

export default router;
