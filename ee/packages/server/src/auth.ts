/**
 * WorkOS AuthKit auth: the session verifier the OSS gate calls, plus the
 * public auth routes (login / callback / logout / me).
 *
 * Session model: AuthKit seals the session into an encrypted cookie
 * (`tc_session`). The verifier unseals + validates it on each request;
 * the callback sets it after exchanging the auth code.
 */

import { Router } from 'express';
import { WorkOS } from '@workos-inc/node';
import type { User } from '@workos-inc/node';
import type { AuthResult, AuthUser, EeAuthVerifier } from '@truecourse/shared';
import type { WorkosConfig } from './config.js';
import { parseCookies, serializeCookie } from './cookies.js';

export const SESSION_COOKIE = 'tc_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isSecure(appUrl: string): boolean {
  return appUrl.startsWith('https://');
}

function toAuthUser(u: User, organizationId?: string | null): AuthUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profilePictureUrl: u.profilePictureUrl,
    organizationId: organizationId ?? null,
  };
}

/**
 * Builds the verifier the OSS auth gate calls on every request.
 *
 * Validates the sealed session; if the access token has expired it
 * transparently refreshes it (via the refresh token) and returns the
 * rotated cookie so the gate can set it. Concurrent requests carrying
 * the same expired cookie share ONE refresh (single-flight) — WorkOS
 * rotates refresh tokens, so parallel refreshes would race and all but
 * one would fail.
 */
export function createSessionVerifier(
  workos: WorkOS,
  cfg: WorkosConfig,
): EeAuthVerifier {
  const secure = isSecure(cfg.appUrl);
  // Keyed by the (expired) sealed cookie so a burst of navigation
  // requests dedupes to a single refresh.
  const refreshInFlight = new Map<string, Promise<AuthResult | null>>();

  async function refresh(
    session: ReturnType<WorkOS['userManagement']['loadSealedSession']>,
  ): Promise<AuthResult | null> {
    const refreshed = await session.refresh();
    if (!refreshed.authenticated || !refreshed.sealedSession) return null;
    return {
      user: toAuthUser(refreshed.user, refreshed.organizationId),
      setCookie: serializeCookie(SESSION_COOKIE, refreshed.sealedSession, {
        maxAgeSeconds: SESSION_MAX_AGE,
        secure,
      }),
    };
  }

  return async (cookieHeader) => {
    const sealed = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!sealed) return null;
    try {
      const session = workos.userManagement.loadSealedSession({
        sessionData: sealed,
        cookiePassword: cfg.cookiePassword,
      });
      const result = await session.authenticate();
      if (result.authenticated) {
        return { user: toAuthUser(result.user, result.organizationId) };
      }
      // Access token expired/invalid → refresh (single-flight per cookie).
      let pending = refreshInFlight.get(sealed);
      if (!pending) {
        pending = refresh(session).finally(() => refreshInFlight.delete(sealed));
        refreshInFlight.set(sealed, pending);
      }
      return await pending;
    } catch {
      return null;
    }
  };
}

/** Public auth router mounted at /api/ee/auth (before the gate). */
export function createAuthRouter(workos: WorkOS, cfg: WorkosConfig): Router {
  const router = Router();
  const verify = createSessionVerifier(workos, cfg);
  const secure = isSecure(cfg.appUrl);

  // Kick off login — redirect to the WorkOS AuthKit hosted UI.
  router.get('/login', (_req, res) => {
    const url = workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
    });
    res.redirect(url);
  });

  // OAuth callback — exchange the code, seal the session into a cookie,
  // then return the browser to the dashboard.
  router.get('/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      res.redirect(`${cfg.appUrl}/?auth_error=missing_code`);
      return;
    }
    try {
      const auth = await workos.userManagement.authenticateWithCode({
        clientId: cfg.clientId,
        code,
        session: { sealSession: true, cookiePassword: cfg.cookiePassword },
      });
      if (!auth.sealedSession) {
        res.redirect(`${cfg.appUrl}/?auth_error=no_session`);
        return;
      }
      res.setHeader(
        'Set-Cookie',
        serializeCookie(SESSION_COOKIE, auth.sealedSession, {
          maxAgeSeconds: SESSION_MAX_AGE,
          secure,
        }),
      );
      res.redirect(cfg.appUrl);
    } catch {
      res.redirect(`${cfg.appUrl}/?auth_error=callback_failed`);
    }
  });

  // Who am I — the client polls this to decide logged-in vs redirect.
  router.get('/me', async (req, res) => {
    const result = await verify(req.headers.cookie);
    if (!result) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (result.setCookie) res.append('Set-Cookie', result.setCookie);
    res.json({ user: result.user });
  });

  // Logout — clear the cookie and hand back the WorkOS logout URL.
  router.post('/logout', async (req, res) => {
    const sealed = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    res.setHeader(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure }),
    );
    if (sealed) {
      try {
        const session = workos.userManagement.loadSealedSession({
          sessionData: sealed,
          cookiePassword: cfg.cookiePassword,
        });
        const logoutUrl = await session.getLogoutUrl({ returnTo: cfg.appUrl });
        res.json({ logoutUrl });
        return;
      } catch {
        // fall through to the app url
      }
    }
    res.json({ logoutUrl: cfg.appUrl });
  });

  return router;
}
