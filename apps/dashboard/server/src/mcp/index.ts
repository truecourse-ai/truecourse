/**
 * The MCP server for developers: its tools, bound to one caller.
 *
 * A developer's MCP client can read their TrueCourse workspace — documents,
 * conflicts, flows, runs, failures, coverage, dependencies, sources — and make
 * the decisions the dashboard offers. It starts no job the dashboard would ask
 * a person to start (a scan, a setup, a generation, a run).
 *
 * The tools are adapters and nothing more: each parses its arguments, calls the
 * service the matching dashboard route calls, and shapes the answer. What this
 * directory may import is pinned by `tests/architecture/mcp-layering.test.ts`.
 * The HTTP half — the gate, the transport — is `routes/mcp.ts`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpCaller } from './caller.js';
import { registerWorkspaceTools } from './workspace-tools.js';
import { registerRepositoryTools } from './repository-tools.js';

export type { McpCaller } from './caller.js';

/** What a model that has never seen TrueCourse is told when it connects. */
const INSTRUCTIONS = `TrueCourse turns a team's documentation into tests that prove the product does what the documents promise.

A workspace gathers documents from its sources (documentation sites, repositories, and others). A scan curates them into one corpus; where two documents disagree, that is a conflict, and an open conflict stops test generation until someone resolves it. From what the corpus claims, TrueCourse derives flows (paths a user takes through the product) for each connected repository, writes tests for each flow, and runs them. A failing test means the product and the documentation disagree.

Start with list_repositories; repository tools take one of its ids. Scans, generation and runs are started from the dashboard, not here.`;

/** One server, its tools bound to one caller. */
export function createTruecourseMcpServer(caller: McpCaller, version: string): McpServer {
  const server = new McpServer({ name: 'truecourse', version }, { instructions: INSTRUCTIONS });
  registerWorkspaceTools(server, caller);
  registerRepositoryTools(server, caller);
  return server;
}
