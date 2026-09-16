/**
 * GET /api/capabilities
 *
 * Reports which feature gates are on. Public (mounted before the auth gate) so
 * the client can read them before authenticating.
 *
 * `edition` is what booted: `enterprise` when the process registered the
 * enterprise bundle it found beside its tree, `community` when it found none.
 * A client built with the enterprise features reads it to know whether the
 * server it reached can answer them — the two are built together but deployed
 * as files, and a server tree without `ee/` beside it is the open edition.
 *
 * `mode` is the one thing here the client cannot know for itself: a local
 * server has no sign-in and offers the folder on this machine as a repository,
 * and this is where it says so — before the client has a session, which is why
 * it rides the public endpoint rather than `/api/auth/me`.
 */

import { Router } from 'express';
import type { CapabilitiesResponse } from '@truecourse/shared';
import { getCapabilities } from '../capabilities.js';
import { registeredServerFeatures } from '../features.js';
import { serverMode } from '../mode.js';

const router: Router = Router();

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = {
    edition: registeredServerFeatures().length > 0 ? 'enterprise' : 'community',
    mode: serverMode(),
    capabilities: getCapabilities(),
  };
  res.json(body);
});

export default router;
