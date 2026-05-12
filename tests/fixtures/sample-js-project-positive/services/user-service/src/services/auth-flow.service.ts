// Auth flow coordinator. The flow needs to delegate session-revalidation
// to the session service, which in turn re-enters the auth flow when the
// session has expired and a step-up challenge is required — that mutual
// dependency is the canonical circular-module-dependency shape.

import { verifySession } from './session-flow.service';

export function runAuthFlow(token: string): boolean {
  if (token.length === 0) return false;
  return verifySession(token);
}
