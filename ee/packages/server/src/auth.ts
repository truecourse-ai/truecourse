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

/**
 * Platform-operator marker: a WorkOS user metadata key/value set in the WorkOS
 * dashboard on TrueCourse-staff accounts. Org-independent (operators span every
 * workspace), so it rides user metadata rather than the per-org WorkOS role.
 */
const OPERATOR_METADATA_KEY = 'role';
const OPERATOR_METADATA_VALUE = 'operator';
const OPERATOR_CACHE_TTL_MS = 5 * 60 * 1000;

function isOperatorUser(u: User): boolean {
  return u.metadata?.[OPERATOR_METADATA_KEY] === OPERATOR_METADATA_VALUE;
}

/**
 * Authoritative operator lookup, cached per user (5-min TTL). The sealed session's
 * `user` is a login-time snapshot and the authenticate endpoint may omit custom
 * `metadata`, so we read it from a fresh `getUser` instead. A metadata change in
 * the WorkOS dashboard therefore takes effect within the TTL (immediately on a
 * cold cache) with NO re-login required.
 */
const operatorCache = new Map<string, { isOperator: boolean; at: number }>();

async function resolveIsOperator(workos: WorkOS, userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = operatorCache.get(userId);
  if (cached && now - cached.at < OPERATOR_CACHE_TTL_MS) return cached.isOperator;
  try {
    const u = await workos.userManagement.getUser(userId);
    const isOperator = isOperatorUser(u);
    operatorCache.set(userId, { isOperator, at: now });
    return isOperator;
  } catch {
    return cached?.isOperator ?? false;
  }
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

  const verify: EeAuthVerifier = async (cookieHeader) => {
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

  // Enrich every authenticated result with the authoritative operator flag (a
  // cached getUser — the sealed session's user may not carry custom metadata).
  return async (cookieHeader) => {
    const result = await verify(cookieHeader);
    if (result) result.user.isOperator = await resolveIsOperator(workos, result.user.id);
    return result;
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

  // Self-serve onboarding: a signed-in user who belongs to no organization
  // (AuthKit signups land org-less) names a workspace; we create the WorkOS
  // org, add them as a member, and RE-MINT the session into it so the cookie
  // carries `organizationId` (everything org-scoped keys off that). Idempotent:
  // a user who already has an org gets it back without creating a second one.
  router.post('/workspace', async (req, res) => {
    const sealed = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!sealed) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const raw = (req.body as { name?: unknown })?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.length > 80) {
      res.status(400).json({ error: 'A workspace name (1–80 characters) is required.' });
      return;
    }
    try {
      const session = workos.userManagement.loadSealedSession({
        sessionData: sealed,
        cookiePassword: cfg.cookiePassword,
      });
      const authed = await session.authenticate();
      if (!authed.authenticated) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      // Already in a workspace → no-op, so a double-submit can't spawn a second
      // org or orphan a membership.
      if (authed.organizationId) {
        res.json({ user: toAuthUser(authed.user, authed.organizationId) });
        return;
      }

      const org = await workos.organizations.createOrganization({ name });
      await workos.userManagement.createOrganizationMembership({
        organizationId: org.id,
        userId: authed.user.id,
      });

      // Re-mint the session INTO the new org so the next `/me` reflects it.
      const refreshed = await session.refresh({ organizationId: org.id });
      if (!refreshed.authenticated || !refreshed.sealedSession) {
        res.status(500).json({
          error: 'Workspace created, but the session could not be updated — sign out and back in.',
        });
        return;
      }
      res.setHeader(
        'Set-Cookie',
        serializeCookie(SESSION_COOKIE, refreshed.sealedSession, {
          maxAgeSeconds: SESSION_MAX_AGE,
          secure,
        }),
      );
      res.json({ user: toAuthUser(refreshed.user, refreshed.organizationId) });
    } catch (err) {
      res.status(500).json({ error: `Could not create workspace: ${(err as Error).message}` });
    }
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
