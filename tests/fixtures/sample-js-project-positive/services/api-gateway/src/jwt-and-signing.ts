/**
 * Shape 1: `jose`'s chained `SignJWT` builder where
 * `.setExpirationTime(...)` precedes `.sign(secret)`. The terminal
 * `.sign(secret)` looks like a no-options JWT sign, but expiry is
 * set up the chain — the rule must NOT fire.
 *
 * Mirrors documenso's
 * packages/lib/server-only/embedding-presign/create-embedding-presign-token.ts:42-50
 */

import { SignJWT } from 'jose';

export function createPresignToken(payload: { sub: string }, secret: Uint8Array, expiresAt: Date): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
}
