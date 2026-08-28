/**
 * The dashboard's auth layer, assembled once at boot.
 *
 * `createAuth()` reads the WorkOS env (throwing if it is incomplete), builds
 * the WorkOS client, and derives the ONE session verifier that both the auth
 * gate and the public auth routes share.
 */

import { WorkOS } from '@workos-inc/node';
import type { Router } from 'express';
import type { AuthVerifier } from '@truecourse/shared';
import { loadWorkosConfig, type WorkosConfig } from './config.js';
import { createAuthRouter, createSessionVerifier } from './workos-auth.js';

export { loadWorkosConfig, type WorkosConfig } from './config.js';
export { parseCookies, serializeCookie } from './cookies.js';
export {
  createAuthRouter,
  createSessionVerifier,
  SESSION_COOKIE,
} from './workos-auth.js';

export interface Auth {
  config: WorkosConfig;
  /** The single verifier — handed to the gate AND already bound into `router`. */
  verify: AuthVerifier;
  /** Public auth routes; mount at `/api/auth`, before the gate. */
  router: Router;
}

export function createAuth(): Auth {
  const config = loadWorkosConfig();
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId });
  const verify = createSessionVerifier(workos, config);
  return { config, verify, router: createAuthRouter(workos, config, verify) };
}
