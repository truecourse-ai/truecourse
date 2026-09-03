/**
 * GET /api/capabilities
 *
 * Reports which feature gates are on. Public (mounted before the auth gate) so
 * the client can read them before authenticating.
 *
 * `edition` MUST stay the constant `'community'`. On `'enterprise'` the
 * client's `EeModuleContext` loads the legacy ee client chunk, which replaces
 * the `/` home and calls `/api/ee/workspace/*` routes that no longer exist. The
 * field itself stays on the wire because the client still reads it.
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
