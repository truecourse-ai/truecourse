/**
 * `/mcp` over HTTP: Streamable HTTP, served by this process. The tools
 * themselves are `mcp/`; this is the adapter that puts them on the wire.
 *
 * Stateless: every POST is one JSON-RPC exchange with a fresh server whose
 * tools are bound to the session the gate resolved, so nothing about a caller
 * outlives its request and one connection is always one workspace. The gate is
 * the mode's (`auth/mcp.ts`); below it nothing knows which mode it is in.
 *
 * A hosted server whose MCP sign-in is not configured answers `/mcp` with 503
 * naming what to set, the way an unconfigured GitHub App does.
 */

import { createRequire } from 'node:module';
import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '@truecourse/core/lib/logger';
import type { McpAuth } from '../auth/mcp.js';
import type { RepoLinkStore } from '../services/repositories.service.js';
import type { ContextGithubAccess } from '../services/context-sources.service.js';
import { actorContext } from '../middleware/actor.js';
import { createTruecourseMcpServer } from '../mcp/index.js';

/** What a hosted server without MCP sign-in tells a client that reaches `/mcp`. */
const MCP_NOT_CONFIGURED =
  'MCP sign-in is not configured on this server. Set WORKOS_AUTHKIT_DOMAIN and TRUECOURSE_MCP_URL, ' +
  'then restart it.';

const VERSION = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

export interface McpRouterDeps {
  /** How a request becomes a session; null on a hosted server without MCP sign-in. */
  auth: McpAuth | null;
  repoLinks: RepoLinkStore | null;
  github: ContextGithubAccess | null;
}

/** A JSON-RPC error body, for the answers the transport never sees. */
function rpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

/**
 * `/mcp` and, hosted, the protected-resource metadata that points a client at
 * the authorization server. Mounted at the application root, outside `/api`.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const router = Router();
  const auth = deps.auth;

  if (!auth) {
    router.all('/mcp', (_req, res) => {
      res.status(503).json({ error: MCP_NOT_CONFIGURED });
    });
    return router;
  }

  if (auth.resourceMetadata) {
    const { path, document } = auth.resourceMetadata;
    router.get(path, (_req, res) => {
      res.json(document);
    });
  }

  router.all('/mcp', auth.gate, actorContext(), async (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      rpcError(res, 405, 'Method not allowed: this server is stateless and takes POST only.');
      return;
    }
    const user = req.user;
    const org = user?.organizationId;
    if (!user || !org) {
      rpcError(res, 403, 'This session has no workspace.');
      return;
    }
    const server = createTruecourseMcpServer(
      { user, org, repoLinks: deps.repoLinks, github: deps.github },
      VERSION,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error(`[mcp] request failed: ${(err as Error)?.stack ?? String(err)}`);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error.');
    }
  });

  return router;
}
