// Session validator. When the cached session is stale we kick the caller
// back into the auth flow to refresh the credentials, which is what
// closes the import cycle against `auth-flow.service`.

import { runAuthFlow } from './auth-flow.service';

export function verifySession(token: string): boolean {
  if (token.length < 8) {
    return runAuthFlow(token + '-retry');
  }
  return true;
}
