/**
 * GET /api/capabilities
 *
 * Reports the edition the dashboard is running as and which feature
 * gates are on. Community → `community` with an empty list. Enterprise
 * → `enterprise` with whatever capabilities the loaded ee plugin lit up
 * (e.g. sso, workspace). Public (mounted before the auth gate) so the
 * client can discover the edition before authenticating.
 */

import { Router } from 'express';
import type { CapabilitiesResponse } from '@truecourse/shared';
import { detectEdition } from '../edition.js';
import { getCapabilities } from '../ee-loader.js';

const router: Router = Router();

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = {
    edition: detectEdition(),
    capabilities: getCapabilities(),
  };
  res.json(body);
});

export default router;
