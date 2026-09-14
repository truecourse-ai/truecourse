/**
 * How this server runs, read once from the environment.
 *
 * `TRUECOURSE_MODE=local` is one developer's machine: no WorkOS, one implicit
 * person in one implicit workspace, and repositories that may be folders on
 * that machine. Anything else — including nothing at all — is `hosted`, so no
 * deployment can drift into running without sign-in because a variable went
 * missing. A value that is neither fails boot rather than being guessed at.
 */

import { DEFAULT_SERVER_MODE, type ServerMode } from '@truecourse/shared';

export function serverMode(): ServerMode {
  const raw = (process.env.TRUECOURSE_MODE ?? '').trim().toLowerCase();
  if (!raw) return DEFAULT_SERVER_MODE;
  if (raw === 'local' || raw === 'hosted') return raw;
  throw new Error(
    `TRUECOURSE_MODE must be 'local' or 'hosted' (got '${raw}'). Leave it unset for hosted.`,
  );
}

export function isLocalMode(): boolean {
  return serverMode() === 'local';
}
