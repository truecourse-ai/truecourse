/**
 * The auth gate.
 *
 * Mounted on `/api` below the public endpoints (auth, capabilities, health):
 * every request that reaches it needs a valid session. There is no allowlist
 * here — a route is public purely by being mounted above the gate in app.ts.
 *
 * Static SPA assets are served outside `/api`, so the dashboard shell always
 * loads — letting the client detect 401 and redirect to login.
 */

import type { RequestHandler } from 'express';
import type { AuthUser, AuthVerifier } from '@truecourse/shared';

// Augment Express's Request with the resolved user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Builds the gate around one verifier. `null` is the test seam: the gate becomes
 * a pass-through so a supertest app can exercise the routes without a session
 * layer. Production always passes the real verifier.
 */
export function createAuthGate(verify: AuthVerifier | null): RequestHandler {
  if (!verify) return (_req, _res, next) => next();

  return async (req, res, next) => {
    try {
      const result = await verify(req.headers.cookie);
      if (!result) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      // The session may have been transparently refreshed; if so, hand the
      // rotated cookie back to the browser.
      if (result.setCookie) res.append('Set-Cookie', result.setCookie);
      req.user = result.user;
      next();
    } catch {
      res.status(401).json({ error: 'Authentication failed' });
    }
  };
}
