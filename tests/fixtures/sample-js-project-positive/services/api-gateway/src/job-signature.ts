/**
 * Shape 2: a project-local `sign(data)` HMAC helper. The file imports
 * NO JWT library — the call is unrelated to JWT. The jwt-no-expiry
 * rule's import gate must filter this out.
 *
 * Mirrors documenso's packages/lib/jobs/client/local.ts:370 where
 * `sign` is imported from '../../server-only/crypto/sign'.
 */

import { sign } from '../../user-service/src/crypto-helpers';

export function buildJobSignature(payload: string): string {
  return sign(payload);
}
