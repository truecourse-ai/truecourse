/**
 * Feature gates the server advertises to the client.
 *
 * Placeholder: there is one product, so every install gets the same community
 * set. When entitlements land this reads the caller's plan instead of a
 * constant — GET /api/capabilities already goes through here so it won't have
 * to change.
 */

import type { Capability } from '@truecourse/shared';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';

export function getCapabilities(): Capability[] {
  return [...COMMUNITY_CAPABILITIES];
}
