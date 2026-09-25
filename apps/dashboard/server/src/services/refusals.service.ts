/**
 * Which errors are REFUSALS — a request the product turned down, in words
 * already written for the person who made it — and the status each one is.
 *
 * The services throw them; every adapter reads them here. A route answers the
 * status with the message, and an MCP tool answers the message as a tool
 * error, so the two can never disagree about what is the caller's to fix and
 * what is a bug. Anything that is not a refusal is a bug: an adapter logs it
 * and tells the caller only that the request failed.
 */

import { log } from '@truecourse/core/lib/logger';
import { ContextConfigError, ContextKindUnsupportedError } from '@truecourse/core/services/context';
import { WorkspaceDescriptionRequiredError } from '@truecourse/core/lib/workspace-profile-store';
import { GuardDependencyWriteError } from '@truecourse/core/commands/guard-dependencies';
import { GuardExternalsWriteError } from '@truecourse/core/commands/guard-externals';
import { InvalidSourceUrlError, LlmsTxtFetchError } from '@truecourse/spec-consolidator';
import { ConflictVerdictError } from './context-decisions.service.js';
import { GuardDecisionError } from './guard-decisions.service.js';
import { DependencyNameRequiredError } from './guard-dependencies.service.js';

/** The HTTP status a refusal is, or null when the error is not one. */
export function refusalStatus(err: unknown): number | null {
  if (err instanceof WorkspaceDescriptionRequiredError) return err.statusCode;
  if (err instanceof ContextConfigError || err instanceof ContextKindUnsupportedError) return 400;
  if (err instanceof InvalidSourceUrlError || err instanceof LlmsTxtFetchError) return 400;
  if (err instanceof ConflictVerdictError || err instanceof GuardDecisionError) return 400;
  if (err instanceof DependencyNameRequiredError) return 400;
  // A refused registration is the user's to fix (an undeclared variable, a
  // class with nothing to register, a broken overlay), never a server fault.
  if (err instanceof GuardDependencyWriteError || err instanceof GuardExternalsWriteError) return 422;
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return err instanceof Error && typeof status === 'number' && status >= 400 && status < 500
    ? status
    : null;
}

/**
 * What a caller is told about an error: a refusal's own words, or — for a bug,
 * which is logged here with where it happened — only that `what` failed.
 */
export function failureMessage(what: string, err: unknown): { refused: boolean; message: string } {
  if (refusalStatus(err) !== null) return { refused: true, message: (err as Error).message };
  log.error(`[${what}] failed: ${(err as Error)?.stack ?? String(err)}`);
  return { refused: false, message: `${what} failed on the server. Try again, or use the dashboard.` };
}
