/**
 * The workspace's DECISIONS about its corpus — a force-include, a
 * force-exclude, a conflict verdict — and the corpus reads they are made
 * against. What the Context routes and the MCP tools both call.
 *
 * The workspace's corpus is one corpus, so a decision is settled ONCE here
 * rather than per repository. Each write persists the decisions ledger; the
 * corpus itself is unchanged until the next scan, which is what the staleness
 * stamp says.
 *
 * What a decision DOES move right away is a Flow generation that stopped on an
 * open conflict, in every repository the decision left with none: every write
 * goes through `settled`, which is that pass (see guard-unblock.service).
 * Whether one decision clears the last conflict of a repository's slice is what
 * the derivation answers, not something a caller can tell from the verb.
 */

import { contextChangedAt, markContextChanged } from '@truecourse/core/lib/context-store';
import { ContextConfigError } from '@truecourse/core/services/context';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  addWorkspaceConflictResolution,
  addWorkspaceManualExclude,
  addWorkspaceManualInclude,
  getWorkspaceDecisions,
  removeWorkspaceConflictResolution,
  removeWorkspaceManualExclude,
  removeWorkspaceManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import type { ConflictResolution, CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { createAppError } from '@truecourse/core/lib/errors';
import {
  buildCorpusConflicts,
  conflictVerdictFor,
  resolveConflictId,
  type CorpusConflict,
} from '@truecourse/shared';
import { captureAction, EVENTS } from '../observability/posthog.js';
import { contextIsStale } from './context-scan.service.js';
import { emitContextChanged } from './context.service.js';
import { unblockWorkspaceGenerates } from './guard-unblock.service.js';

/** Who made a decision, for the analytics event it lands as. */
export interface DecisionActor {
  org: string;
  userId?: string;
}

/**
 * Write one workspace decision, then start the Flow generation it unblocked in
 * every repository whose conflicts it settled.
 */
async function settled(org: string, write: () => Promise<DecisionsFile>): Promise<DecisionsFile> {
  const decisions = await write();
  await unblockWorkspaceGenerates(org);
  return decisions;
}

/**
 * An INCLUSION decision, on top of {@link settled}: it changes which documents
 * the corpus should hold, and only a scan can apply it. So the workspace's
 * changed-at stamp moves and the change is announced — which is what lights
 * the amber dot on Scan and says a scan is what is missing.
 *
 * A conflict verdict is not one of these: it is applied at Flow generation, so
 * it leaves the corpus's own document set alone.
 */
async function decided(org: string, write: () => Promise<DecisionsFile>): Promise<DecisionsFile> {
  const decisions = await settled(org, write);
  await markContextChanged(org);
  await emitContextChanged(org, { change: 'documents' });
  return decisions;
}

/** A document ref off a caller's request, or a refusal. */
function readRef(ref: unknown): string {
  if (typeof ref !== 'string' || !ref.trim()) throw new ContextConfigError('Missing ref.');
  return ref.trim();
}

/** The inclusion ledger as every inclusion decision answers it. */
export interface InclusionAck {
  manualIncludes: string[];
  manualExcludes: string[];
}

const inclusionAck = (decisions: DecisionsFile): InclusionAck => ({
  manualIncludes: decisions.manualIncludes ?? [],
  manualExcludes: decisions.manualExcludes ?? [],
});

/** Force-include a document into the corpus the next scan builds. */
export async function includeDocument(org: string, ref: unknown): Promise<InclusionAck> {
  const doc = readRef(ref);
  return inclusionAck(await decided(org, () => addWorkspaceManualInclude(org, doc)));
}

/** Undo a force-include. */
export async function unincludeDocument(org: string, ref: unknown): Promise<InclusionAck> {
  const doc = readRef(ref);
  return inclusionAck(await decided(org, () => removeWorkspaceManualInclude(org, doc)));
}

/** Force-exclude a document from the corpus the next scan builds. */
export async function excludeDocument(org: string, ref: unknown): Promise<InclusionAck> {
  const doc = readRef(ref);
  return inclusionAck(await decided(org, () => addWorkspaceManualExclude(org, doc)));
}

/** Undo a force-exclude. */
export async function unexcludeDocument(org: string, ref: unknown): Promise<InclusionAck> {
  const doc = readRef(ref);
  return inclusionAck(await decided(org, () => removeWorkspaceManualExclude(org, doc)));
}

/** The verdicts a conflict resolution may carry. */
export const CONFLICT_VERDICTS = ['a', 'b', 'dismissed'] as const;

/** A verdict on one conflict, keyed by the dispute's two sections. */
export interface ConflictVerdictRequest {
  docA?: string;
  anchorA?: string | null;
  quoteA?: string;
  docB?: string;
  anchorB?: string | null;
  quoteB?: string;
  verdict?: unknown;
  note?: string;
}

/** A refused verdict: the request itself is malformed. */
export class ConflictVerdictError extends Error {}

/** Record a conflict verdict: one side is right, or the conflict is not one. */
export async function resolveConflict(
  actor: DecisionActor,
  request: ConflictVerdictRequest,
): Promise<ConflictResolution[]> {
  const { docA, docB, verdict } = request;
  if (!docA || !docB || docA === docB) {
    throw new ConflictVerdictError('docA and docB are required and must differ.');
  }
  if (typeof verdict !== 'string' || !(CONFLICT_VERDICTS as readonly string[]).includes(verdict)) {
    throw new ConflictVerdictError(`verdict must be one of ${CONFLICT_VERDICTS.join(', ')}.`);
  }
  const decisions = await settled(actor.org, () =>
    addWorkspaceConflictResolution(actor.org, {
      docA,
      anchorA: request.anchorA ?? null,
      quoteA: request.quoteA,
      docB,
      anchorB: request.anchorB ?? null,
      quoteB: request.quoteB,
      verdict: verdict as ConflictResolution['verdict'],
      resolvedAt: new Date().toISOString(),
      note: request.note,
    }),
  );
  if (actor.userId) {
    captureAction(EVENTS.conflictResolved, {
      userId: actor.userId,
      workspaceId: actor.org,
      properties: { verdict },
    });
  }
  return decisions.conflictResolutions ?? [];
}

/** Undo a conflict verdict, named by the dispute's two sections. */
export async function unresolveConflict(
  org: string,
  request: { docA?: string; anchorA?: string | null; docB?: string; anchorB?: string | null },
): Promise<ConflictResolution[]> {
  const { docA, docB } = request;
  if (!docA || !docB) throw new ConflictVerdictError('docA and docB are required.');
  const decisions = await settled(org, () =>
    removeWorkspaceConflictResolution(org, {
      docA,
      docB,
      anchorA: request.anchorA ?? null,
      anchorB: request.anchorB ?? null,
    }),
  );
  return decisions.conflictResolutions ?? [];
}

// --- Reads ---------------------------------------------------------------------

/** The workspace corpus and the decisions standing against it; null before the first scan. */
export async function readWorkspaceCorpus(org: string): Promise<{
  corpus: CuratedCorpus;
  manualIncludes: string[];
  manualExcludes: string[];
  conflictResolutions: ConflictResolution[];
} | null> {
  const [corpus, decisions] = await Promise.all([
    loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
    getWorkspaceDecisions(org),
  ]);
  if (!corpus) return null;
  return {
    corpus,
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
    conflictResolutions: decisions.conflictResolutions ?? [],
  };
}

/** One conflict of the workspace corpus, as the shared derivation classifies it. */
export type WorkspaceConflict = CorpusConflict<CuratedCorpus['areas'][number]['overlaps'][number]>;

/**
 * The workspace corpus's conflicts, each classified open or resolved by the
 * one shared derivation every surface reads; with `open`, only the ones still
 * open, which are the ones that stop a Flow generation. Empty before the first
 * scan.
 */
export async function workspaceConflicts(
  org: string,
  filter: { open?: boolean } = {},
): Promise<WorkspaceConflict[]> {
  const read = await readWorkspaceCorpus(org);
  if (!read) return [];
  const conflicts = buildCorpusConflicts(read.corpus, read);
  return filter.open ? conflicts.filter((c) => !c.resolved) : conflicts;
}

/** The conflict an id names in the workspace corpus, or a 404. */
export async function findWorkspaceConflict(org: string, id: string): Promise<WorkspaceConflict> {
  const conflict = resolveConflictId(await workspaceConflicts(org), id);
  if (!conflict) throw createAppError(`No conflict "${id}" in this workspace's corpus.`, 404);
  return conflict;
}

/**
 * Record a verdict on the conflict an id names: the same record the
 * dashboard's verdict buttons write, keyed on each side's flagged section.
 * Answers the conflict as it now stands.
 */
export async function resolveConflictById(
  actor: DecisionActor,
  id: string,
  verdict: ConflictResolution['verdict'],
  note?: string,
): Promise<WorkspaceConflict> {
  const conflict = await findWorkspaceConflict(actor.org, id);
  await resolveConflict(actor, {
    ...conflictVerdictFor(conflict.overlap, conflict.a, conflict.b, verdict),
    ...(note ? { note } : {}),
  });
  return findWorkspaceConflict(actor.org, id);
}

/**
 * Withdraw the verdict on the conflict an id names. Only a verdict can be
 * withdrawn: a conflict resolved because one side is force-excluded opens again
 * by undoing that exclusion. Answers the conflict as it now stands.
 */
export async function unresolveConflictById(org: string, id: string): Promise<WorkspaceConflict> {
  const conflict = await findWorkspaceConflict(org, id);
  if (!conflict.resolution) {
    throw new ConflictVerdictError(
      conflict.excludedRef
        ? `This conflict is resolved because ${conflict.excludedRef} is excluded, not by a verdict.`
        : 'This conflict has no verdict to withdraw.',
    );
  }
  const { docA, anchorA, docB, anchorB } = conflict.resolution;
  await unresolveConflict(org, { docA, anchorA, docB, anchorB });
  return findWorkspaceConflict(org, id);
}

/**
 * Has the workspace's Context moved since the corpus was built? One stamp
 * against one stamp. No corpus yet is not "stale": there is nothing to be
 * behind.
 */
export async function workspaceStaleness(
  org: string,
): Promise<{ changedAt: string | null; corpusAt: string | null; stale: boolean }> {
  const [changedAt, corpus] = await Promise.all([
    contextChangedAt(org),
    loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
  ]);
  const corpusAt = corpus?.generatedAt ?? null;
  return { changedAt, corpusAt, stale: contextIsStale(corpusAt, changedAt) };
}
