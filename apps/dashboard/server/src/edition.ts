/**
 * Edition detection for the dashboard server.
 *
 * Enterprise mode is on when explicitly requested via
 * `TRUECOURSE_EDITION=enterprise`, or implicitly when WorkOS is
 * configured (API key + client id present). Anything else is the
 * community edition — the default, unauthenticated experience.
 *
 * Read live from the environment (not cached) so tests can flip it per
 * request and so a restart with new env takes effect.
 */

import type { Edition } from '@truecourse/shared';

export function detectEdition(): Edition {
  const explicit = process.env.TRUECOURSE_EDITION?.toLowerCase();
  if (explicit === 'enterprise') return 'enterprise';
  if (explicit === 'community') return 'community';

  const workosConfigured = Boolean(
    process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID,
  );
  return workosConfigured ? 'enterprise' : 'community';
}

export function isEnterprise(): boolean {
  return detectEdition() === 'enterprise';
}
