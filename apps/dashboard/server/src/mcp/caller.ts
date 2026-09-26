/**
 * What every MCP tool is handed, and the few things every tool does the same
 * way: address a repository, answer, refuse.
 *
 * A tool acts as the session the `/mcp` gate resolved — one person in one
 * workspace — and reaches the workspace's repositories through the same
 * scoping the dashboard's project-scoped routes use, so a repository another
 * workspace connected is not found here either.
 *
 * Whether an error is a refusal the caller can act on, and in what words, is
 * the refusals service's answer, the same one every route reads.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthUser } from '@truecourse/shared';
import {
  resolveRepository,
  type RepoLinkStore,
} from '../services/repositories.service.js';
import type { ContextCaller, ContextGithubAccess } from '../services/context-sources.service.js';
import { failureMessage } from '../services/refusals.service.js';

/** The session a tool runs as, and what its repositories are answered from. */
export interface McpCaller {
  user: AuthUser;
  /** The workspace — the organization the session names. */
  org: string;
  repoLinks: RepoLinkStore | null;
  github: ContextGithubAccess | null;
}

/** The caller as the Context services take it. */
export function contextCallerOf(caller: McpCaller): ContextCaller {
  return {
    org: caller.org,
    userId: caller.user.id,
    repoLinks: caller.repoLinks,
    github: caller.github,
  };
}

/** A repository argument that names nothing in this workspace. */
class UnknownRepository extends Error {
  readonly statusCode = 404;
}

/** The repository a tool argument names — its id or its `owner/repo` name. */
export async function resolveRepo(caller: McpCaller, repo: string) {
  const entry = await resolveRepository(caller.repoLinks, caller.org, repo);
  if (!entry) {
    throw new UnknownRepository(
      `No repository "${repo.trim()}" in this workspace. list_repositories names the ones there are.`,
    );
  }
  return entry;
}

/** A tool's answer: compact JSON. */
export function answer(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Run one tool call, turning a refusal into a tool error the model can read. */
export async function run(tool: string, body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return answer(await body());
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: failureMessage(tool, err).message }] };
  }
}
