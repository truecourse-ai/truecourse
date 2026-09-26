/**
 * A repository's guard DECISIONS that take a flow or a claim out of testing,
 * and their undo: what the guard action routes and the MCP tools both call.
 *
 * Each is an instant write to the repository's decisions ledger — no job, no
 * lock, and nothing the engine is touching. The next Flow generation reads the
 * ledger: a dismissed flow is dropped with its tests and settled as a
 * `dismissed` gap, and an undismissed one is generated again.
 *
 * A TEST is deliberately not dismissable: its id is generated, so a dismissal
 * would silently stop matching the moment the flow is re-authored.
 */

import {
  dismissGuardFlow,
  guardFlowExists,
  undismissGuardClaim,
  undismissGuardFlow,
} from '@truecourse/core/commands/guard-read';
import { createAppError } from '@truecourse/core/lib/errors';
import type { GuardDecisions } from '@truecourse/shared';
import { captureAction, EVENTS } from '../observability/posthog.js';

/** Who acted, and in which repository, for the analytics event a dismissal lands as. */
export interface GuardDecisionActor {
  org: string;
  userId?: string;
  /** The repository's slug. */
  repoId: string;
}

/** A refused decision: the request itself is malformed. */
export class GuardDecisionError extends Error {}

/**
 * Dismiss a whole FLOW, one the repository has. Idempotent on `flowId`;
 * answers the updated ledger.
 */
export async function dismissFlow(
  actor: GuardDecisionActor,
  repoPath: string,
  request: { flowId?: string; note?: string },
): Promise<GuardDecisions> {
  const { flowId, note } = request;
  if (!flowId) throw new GuardDecisionError('flow dismiss requires { flowId }.');
  if (!(await guardFlowExists(repoPath, flowId))) {
    throw createAppError(`Flow not found: ${flowId}`, 404);
  }
  const written = await dismissGuardFlow(repoPath, {
    flowId,
    dismissedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
  if (actor.userId) {
    captureAction(EVENTS.findingDismissed, {
      userId: actor.userId,
      workspaceId: actor.org,
      properties: { kind: 'flow', repoId: actor.repoId },
    });
  }
  return written;
}

/** Reverse a flow dismissal. A no-op when there is none; answers the updated ledger. */
export async function undismissFlow(
  repoPath: string,
  request: { flowId?: string },
): Promise<GuardDecisions> {
  if (!request.flowId) throw new GuardDecisionError('flow undismiss requires { flowId }.');
  return undismissGuardFlow(repoPath, request.flowId);
}

/**
 * Reverse a claim dismissal by its identity `{ doc, anchor, title }`. A no-op
 * when there is none; answers the updated ledger.
 */
export async function undismissClaim(
  repoPath: string,
  request: { doc?: string; anchor?: string; title?: string },
): Promise<GuardDecisions> {
  const { doc, anchor, title } = request;
  if (!doc || !anchor || !title) {
    throw new GuardDecisionError('undismiss requires { doc, anchor, title }.');
  }
  return undismissGuardClaim(repoPath, { doc, anchor, title });
}
