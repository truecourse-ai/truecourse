/**
 * The MCP server for developers: `/mcp`, Streamable HTTP, served by this
 * process.
 *
 * A developer adds it to their MCP client once and the client can read their
 * TrueCourse workspace — documents, conflicts, flows, runs, failures, coverage,
 * dependencies, sources — and make the decisions the dashboard offers. It
 * starts no job the dashboard would ask a person to start (a scan, a setup, a
 * generation, a run).
 *
 * Stateless: every POST is one JSON-RPC exchange with a fresh server whose
 * tools are bound to the session the gate resolved, so nothing about a caller
 * outlives its request and one connection is always one workspace. The gate is
 * the mode's (`auth/mcp.ts`); below it nothing knows which mode it is in, and
 * every tool calls what the matching dashboard route calls.
 *
 * A hosted server whose MCP sign-in is not configured answers `/mcp` with 503
 * naming what to set, the way an unconfigured GitHub App does.
 */

import { createRequire } from 'node:module';
import { Router, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '@truecourse/core/lib/logger';
import type { McpAuth } from '../auth/mcp.js';
import type { RepoLinkStore } from '../routes/repos.js';
import type { ContextGithubAccess } from '../services/context-sources.service.js';
import { actorContext } from '../middleware/actor.js';
import type { McpCaller } from './caller.js';
import { registerWorkspaceTools } from './workspace-tools.js';
import { registerRepositoryTools } from './repository-tools.js';

/** What a hosted server without MCP sign-in tells a client that reaches `/mcp`. */
const MCP_NOT_CONFIGURED =
  'MCP sign-in is not configured on this server. Set WORKOS_AUTHKIT_DOMAIN and TRUECOURSE_MCP_URL, ' +
  'then restart it.';

const VERSION = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

/** What a model that has never seen TrueCourse is told when it connects. */
const INSTRUCTIONS = `TrueCourse turns a team's documentation into tests that prove the product does what the documents promise.

A workspace gathers documents from its sources (documentation sites, repositories, and others). A scan curates them into one corpus; where two documents disagree, that is a conflict, and an open conflict stops test generation until someone resolves it. From what the corpus claims, TrueCourse derives flows (paths a user takes through the product) for each connected repository, writes tests for each flow, and runs them. A failing test means the product and the documentation disagree.

Start with list_repositories; repository tools take one of its ids. Scans, generation and runs are started from the dashboard, not here.`;

export interface McpRouterDeps {
  /** How a request becomes a session; null on a hosted server without MCP sign-in. */
  auth: McpAuth | null;
  repoLinks: RepoLinkStore | null;
  github: ContextGithubAccess | null;
}

/** One server, its tools bound to one caller. */
export function createTruecourseMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer({ name: 'truecourse', version: VERSION }, { instructions: INSTRUCTIONS });
  registerWorkspaceTools(server, caller);
  registerRepositoryTools(server, caller);
  return server;
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
    const server = createTruecourseMcpServer({
      user,
      org,
      repoLinks: deps.repoLinks,
      github: deps.github,
    });
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
