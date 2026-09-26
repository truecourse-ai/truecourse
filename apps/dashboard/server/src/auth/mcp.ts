/**
 * How a request to `/mcp` becomes a session.
 *
 * The MCP endpoint carries no cookie: a developer's MCP client sends an OAuth
 * bearer token, per the MCP authorization spec. This module is the ONLY place
 * the two modes differ for it — below the gate every tool sees the same
 * `req.user` a dashboard route does.
 *
 * Hosted: WorkOS AuthKit is the authorization server. This server is the
 * protected resource: it publishes metadata naming AuthKit, refuses a request
 * with no valid token with a 401 whose `WWW-Authenticate` points at that
 * metadata, and verifies the access token AuthKit issued against AuthKit's
 * JWKS — its issuer, and an audience of this server's own MCP URL. The token's
 * `org_id` is the workspace, one connection one workspace, and the membership
 * behind it is asked again the way the cookie session's is, so a member
 * removed since is refused before the token expires. No token is stored here.
 *
 * Local: there is nobody to authenticate. Every request is the machine's one
 * person in its one workspace, and no metadata is advertised.
 */

import type { RequestHandler } from 'express';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import {
  InsufficientScopeError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AuthUser } from '@truecourse/shared';
import { localUser } from './local.js';

/** The OAuth 2.0 protected-resource metadata (RFC 9728) this server publishes. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
}

export interface McpAuth {
  /** Resolves the request onto `req.user`, or answers the refusal itself. */
  gate: RequestHandler;
  /** Hosted: the metadata document and the path it is served at. Local: none. */
  resourceMetadata: { path: string; document: ProtectedResourceMetadata } | null;
  /** The URL a developer's MCP client connects to. */
  url: string;
}

/** Local mode: the one person, always, at this machine's `/mcp` on `port`. */
export function createLocalMcpAuth(port: number): McpAuth {
  return {
    gate: (req, _res, next) => {
      req.user = localUser();
      next();
    },
    resourceMetadata: null,
    url: `http://localhost:${port}/mcp`,
  };
}

/** What the hosted gate is built from. Boot hands the real ones; a test its own. */
export interface HostedMcpAuthOptions {
  /** The AuthKit domain as an origin — the tokens' issuer. */
  issuer: string;
  /** This server's MCP URL — the tokens' audience and the metadata's `resource`. */
  resource: string;
  /** AuthKit's signing keys. */
  keys: JWTVerifyGetKey;
  /** Whether a user's membership of an organization still stands. */
  isMember(userId: string, organizationId: string): Promise<boolean>;
}

/** The session a verified token stands for, carried on the SDK's auth info. */
interface McpTokenExtra extends Record<string, unknown> {
  user: AuthUser;
}

function tokenVerifier(opts: HostedMcpAuthOptions): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
      try {
        ({ payload } = await jwtVerify(token, opts.keys, {
          issuer: opts.issuer,
          audience: opts.resource,
        }));
      } catch {
        throw new InvalidTokenError('The access token is not valid for this server.');
      }
      const userId = typeof payload.sub === 'string' ? payload.sub : '';
      if (!userId) throw new InvalidTokenError('The access token names no user.');
      const org = typeof payload.org_id === 'string' ? payload.org_id : '';
      if (!org) {
        throw new InsufficientScopeError(
          'This sign-in chose no workspace. Sign in again and choose the workspace to connect.',
        );
      }
      if (!(await opts.isMember(userId, org))) {
        throw new InvalidTokenError('You are no longer a member of this workspace.');
      }
      const user: AuthUser = { id: userId, email: '', organizationId: org };
      const extra: McpTokenExtra = { user };
      const clientId =
        typeof payload.client_id === 'string'
          ? payload.client_id
          : typeof payload.azp === 'string'
            ? payload.azp
            : '';
      return {
        token,
        clientId,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
        ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {}),
        resource: new URL(opts.resource),
        extra,
      };
    },
  };
}

/** Hosted mode: an AuthKit-issued bearer token, verified here. */
export function createHostedMcpAuth(opts: HostedMcpAuthOptions): McpAuth {
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(opts.resource));
  const bearer = requireBearerAuth({
    verifier: tokenVerifier(opts),
    resourceMetadataUrl: metadataUrl,
  });
  return {
    gate: (req, res, next) => {
      void bearer(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        req.user = (req.auth?.extra as McpTokenExtra).user;
        next();
      });
    },
    resourceMetadata: {
      path: new URL(metadataUrl).pathname,
      document: {
        resource: opts.resource,
        authorization_servers: [opts.issuer],
        bearer_methods_supported: ['header'],
      },
    },
    url: opts.resource,
  };
}

/** Where a hosted server's MCP sign-in comes from, read from the environment. */
export interface McpOAuthConfig {
  /** `WORKOS_AUTHKIT_DOMAIN`: the AuthKit domain, as an https origin. */
  issuer: string;
  /** `TRUECOURSE_MCP_URL`: the public URL of this server's `/mcp`. */
  resource: string;
}

function httpUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[auth] ${name} must be a full URL (got '${value}')`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`[auth] ${name} must be an http(s) URL (got '${value}')`);
  }
  return url;
}

/**
 * Both or neither. Neither is a hosted server without MCP sign-in: `/mcp` then
 * answers 503 naming what to set. One without the other fails boot naming the
 * missing one, rather than serving a sign-in that cannot complete.
 */
export function loadMcpOAuthConfig(): McpOAuthConfig | null {
  const domain = process.env.WORKOS_AUTHKIT_DOMAIN || '';
  const mcpUrl = process.env.TRUECOURSE_MCP_URL || '';
  if (!domain && !mcpUrl) return null;
  if (!domain) throw new Error('[auth] TRUECOURSE_MCP_URL is set but WORKOS_AUTHKIT_DOMAIN is not');
  if (!mcpUrl) throw new Error('[auth] WORKOS_AUTHKIT_DOMAIN is set but TRUECOURSE_MCP_URL is not');
  const issuer = httpUrl('WORKOS_AUTHKIT_DOMAIN', domain);
  if (issuer.pathname !== '/' || issuer.search || issuer.hash) {
    throw new Error(`[auth] WORKOS_AUTHKIT_DOMAIN must be an origin, like https://example.authkit.app (got '${domain}')`);
  }
  const resource = httpUrl('TRUECOURSE_MCP_URL', mcpUrl);
  if (!resource.pathname.endsWith('/mcp')) {
    throw new Error(`[auth] TRUECOURSE_MCP_URL must be the URL of this server's /mcp (got '${mcpUrl}')`);
  }
  return { issuer: issuer.origin, resource: resource.href };
}
