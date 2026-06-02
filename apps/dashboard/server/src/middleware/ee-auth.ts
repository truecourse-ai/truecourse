/**
 * Enterprise auth gate.
 *
 * Mounted on `/api` below the public endpoints (auth, capabilities,
 * health). When an enterprise session layer is active it requires a
 * valid session for every request that reaches it; in the community
 * edition there's no verifier, so it's a transparent pass-through.
 *
 * Static SPA assets are served outside `/api`, so the dashboard shell
 * always loads — letting the client detect 401 and redirect to login.
 */

import type { RequestHandler } from 'express';
import type { AuthUser } from '@truecourse/shared';
import { getAuthVerifier } from '../ee-loader.js';

// Augment Express's Request with the resolved enterprise user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      eeUser?: AuthUser;
    }
  }
}

export const enterpriseAuthGate: RequestHandler = async (req, res, next) => {
  const verify = getAuthVerifier();
  if (!verify) {
    next();
    return;
  }
  try {
    const result = await verify(req.headers.cookie);
    if (!result) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    // The session may have been transparently refreshed; if so, hand the
    // rotated cookie back to the browser.
    if (result.setCookie) res.append('Set-Cookie', result.setCookie);
    req.eeUser = result.user;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
};
