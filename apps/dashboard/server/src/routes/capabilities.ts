/**
 * GET /api/capabilities
 *
 * Reports the edition the dashboard is running as and which feature
 * gates are turned on. OSS always reports `community` with an empty
 * list. The enterprise build (under `ee/`) will replace this router
 * with one that validates a signed license key and emits the
 * unlocked capabilities — the client just consumes the response
 * either way.
 */

import { Router } from 'express';
import type {
  CapabilitiesResponse,
  Edition,
  Capability,
} from '@truecourse/shared';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';

const router: Router = Router();

const EDITION: Edition = 'community';
const CAPABILITIES: Capability[] = [...COMMUNITY_CAPABILITIES];

router.get('/', (_req, res) => {
  const body: CapabilitiesResponse = {
    edition: EDITION,
    capabilities: CAPABILITIES,
  };
  res.json(body);
});

export default router;
