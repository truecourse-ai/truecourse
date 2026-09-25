/**
 * What every MCP tool is handed, and the few things every tool does the same
 * way: address a repository, answer, refuse.
 *
 * A tool acts as the session the `/mcp` gate resolved — one person in one
 * workspace — and reaches the workspace's repositories through the SAME
 * resolver the dashboard's project-scoped routes use, so a repository another
 * workspace connected is not found here either.
 *
 * Refusals the product already words for a person (a 4xx `AppError`, an
 * engine's validation error) go back to the model as a tool error in those
 * words. Anything else is a bug: it is logged, and the model is told only that
 * the call failed.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import { log } from '@truecourse/core/lib/logger';
import { ContextConfigError, ContextKindUnsupportedError } from '@truecourse/core/services/context';
import { InvalidSourceUrlError, LlmsTxtFetchError } from '@truecourse/spec-consolidator';
import { WorkspaceDescriptionRequiredError } from '@truecourse/core/lib/workspace-profile-store';
import { GuardDependencyWriteError } from '@truecourse/core/commands/guard-dependencies';
import { GuardExternalsWriteError } from '@truecourse/core/commands/guard-externals';
import type { AuthUser } from '@truecourse/shared';
import type { RepoLinkStore } from '../routes/repos.js';
import { resolveVisibleProject } from '../middleware/project.js';
import { visibleRepositories } from '../services/repositories.service.js';
import type { ContextCaller, ContextGithubAccess } from '../services/context-sources.service.js';
import { ConflictVerdictError } from '../services/context-decisions.service.js';
import { GuardDecisionError } from '../services/guard-decisions.service.js';
import { DependencyNameRequiredError } from '../services/guard-dependencies.service.js';

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

/** A refusal with words meant for the person the model is working for. */
export class ToolRefusal extends Error {}

/**
 * The repository a tool argument names — its id (the slug `list_repositories`
 * answers) or its `owner/repo` name — when this workspace may see it.
 */
export async function resolveRepo(caller: McpCaller, repo: string): Promise<RegistryEntry> {
  const asked = repo.trim();
  const bySlug = await resolveVisibleProject(caller.repoLinks, caller.org, asked);
  if (bySlug) return bySlug;
  const byName = (await visibleRepositories(caller.repoLinks, caller.org)).find(
    (entry) => entry.name === asked,
  );
  if (byName) return byName;
  throw new ToolRefusal(
    `No repository "${asked}" in this workspace. list_repositories names the ones there are.`,
  );
}

/** A tool's answer: compact JSON. */
export function answer(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Errors whose message is already written for a person. */
function isWorded(err: unknown): err is Error {
  if (err instanceof ToolRefusal) return true;
  if (err instanceof WorkspaceDescriptionRequiredError) return true;
  if (err instanceof ContextConfigError || err instanceof ContextKindUnsupportedError) return true;
  if (err instanceof InvalidSourceUrlError || err instanceof LlmsTxtFetchError) return true;
  if (err instanceof ConflictVerdictError || err instanceof GuardDecisionError) return true;
  if (err instanceof GuardDependencyWriteError || err instanceof GuardExternalsWriteError) return true;
  if (err instanceof DependencyNameRequiredError) return true;
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return err instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
}

/** Run one tool call, turning a refusal into a tool error the model can read. */
export async function run(
  tool: string,
  body: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return answer(await body());
  } catch (err) {
    if (isWorded(err)) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    log.error(`[mcp] ${tool} failed: ${(err as Error)?.stack ?? String(err)}`);
    return {
      isError: true,
      content: [{ type: 'text', text: `${tool} failed on the server. Try again, or use the dashboard.` }],
    };
  }
}
