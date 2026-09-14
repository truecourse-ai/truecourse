/**
 * GET /api/capabilities
 *
 * Reports which feature gates are on. Public (mounted before the auth gate) so
 * the client can read them before authenticating.
 *
 * `edition` is the constant `'community'`: there is one product, and which
 * edition a deployment runs is decided when its bundle is built, not answered
 * over the wire. The field stays because the client still reads it.
 */

import { Router } from 'express';
import type { CapabilitiesResponse } from '@truecourse/shared';
import { getCapabilities } from '../capabilities.js';

const router: Router = Router();

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = {
    edition: 'community',
    capabilities: getCapabilities(),
  };
  res.json(body);
});

export default router;
