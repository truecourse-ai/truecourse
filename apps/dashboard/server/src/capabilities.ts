/**
 * Feature gates the server advertises to the client.
 *
 * Placeholder: there is one product, so every install gets the same community
 * set. When entitlements land this reads the caller's plan instead of a
 * constant — the call sites (GET /api/capabilities, the local-filesystem gate
 * on /api/repos/browse) already go through here so they won't have to change.
 */

import type { Capability } from '@truecourse/shared';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';

export function getCapabilities(): Capability[] {
  return [...COMMUNITY_CAPABILITIES];
}
