/**
 * THE COMPARISON a pull request check is judged by: the head's run against the
 * base's, the head's corpus against the workspace's, the head's manifest
 * against the base's. Pure — every input is a stored artifact the job read
 * before, so a control run or a rerun can be put in front of it later without
 * touching it.
 */

import {
  conflictKey,
  openConflicts,
  type CorpusConflict,
  type CorpusLike,
  type DecisionsLike,
  type GuardCoveragePlainStatus,
  type GuardManifest,
  type GuardRunFlowSummary,
} from '@truecourse/shared';

export type FlowDeltaKind =
  /** Held at the base (or was not there), fails at the head: what fails the check. */
  | 'new-failure'
  /** Failed at both. */
  | 'pre-existing'
  /** Failed at the base, PASSES at the head. A failure that only stopped running is not fixed. */
  | 'fixed'
  /** Held at the base, could not run at the head. Reported, never a failure: a fork always has these. */
  | 'newly-blocked'
  /** Could not run or had no scenario at the base, PASSES at the head: coverage the head gained. */
  | 'newly-covered'
  /** A flow the head has and the base did not, and it does not fail. */
  | 'added'
  /** A flow the base had and the head does not. */
  | 'retired'
  | 'unchanged';

export interface FlowDelta {
  flowId: string;
  kind: FlowDeltaKind;
  base: GuardCoveragePlainStatus | null;
  head: GuardCoveragePlainStatus | null;
}

/** One row per flow either run knew, in flow-id order. */
export function compareFlows(base: GuardRunFlowSummary, head: GuardRunFlowSummary): FlowDelta[] {
  const ids = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  return ids.map((flowId) => {
    const before = base[flowId] ?? null;
    const after = head[flowId] ?? null;
    return { flowId, kind: deltaKind(before, after), base: before, head: after };
  });
}

/** A flow a run proved: it succeeded, with or without healing around a renamed control. */
const proven = (status: GuardCoveragePlainStatus | null): boolean =>
  status === 'succeeded' || status === 'partially-succeeded';

function deltaKind(
  base: GuardCoveragePlainStatus | null,
  head: GuardCoveragePlainStatus | null,
): FlowDeltaKind {
  if (head === null) return 'retired';
  if (head === 'failed') return base === 'failed' ? 'pre-existing' : 'new-failure';
  if (base === null) return 'added';
  if (base === 'failed') return proven(head) ? 'fixed' : 'unchanged';
  if (proven(base) && head === 'blocked') return 'newly-blocked';
  if (proven(head) && (base === 'blocked' || base === 'never-run')) return 'newly-covered';
  return 'unchanged';
}

/**
 * The open conflicts of the head's corpus that the workspace's corpus does not
 * carry, by conflict identity (each side's doc and sentence), so a new
 * disagreement between two sections the workspace already has a conflict on at another
 * point is a conflict created. The workspace corpus is its CURRENT one: a
 * corpus has no commit dimension.
 */
export function conflictsCreated<O extends CorpusConflict>(
  defaultCorpus: CorpusLike | null,
  prConflicts: readonly O[],
  decisions: DecisionsLike,
): O[] {
  const known = new Set(
    (defaultCorpus ? openConflicts(defaultCorpus, decisions) : []).map((c) =>
      conflictKey(c.a, c.b, c.sections),
    ),
  );
  return prConflicts.filter((c) => !known.has(conflictKey(c.a, c.b, c.sections)));
}

export interface DocMoved {
  doc: string;
  /** The flows bound to the document at the head whose bound sentences moved. */
  flowIds: string[];
}

/**
 * The documents both manifests bind where a head flow's bound sentences differ
 * from every sentence set the base bound in that document — the documents the
 * pull request changed under a flow — each with the flows that read it, which
 * go stale with it.
 */
export function docsMoved(base: GuardManifest | null, head: GuardManifest | null): DocMoved[] {
  // Every sentence set the base bound a document under: two base flows can hold
  // the same document at different sentences.
  const before = new Map<string, Set<string>>();
  for (const flow of base?.flows ?? []) {
    for (const binding of flow.bindings) {
      before.set(binding.doc, (before.get(binding.doc) ?? new Set()).add(sentenceSetKey(binding.sentences)));
    }
  }
  const moved = new Map<string, DocMoved>();
  for (const flow of head?.flows ?? []) {
    for (const binding of flow.bindings) {
      const was = before.get(binding.doc);
      if (was === undefined || was.has(sentenceSetKey(binding.sentences))) continue;
      const entry = moved.get(binding.doc) ?? { doc: binding.doc, flowIds: [] };
      if (!entry.flowIds.includes(flow.flowId)) entry.flowIds.push(flow.flowId);
      moved.set(binding.doc, entry);
    }
  }
  return [...moved.values()].sort((a, b) => a.doc.localeCompare(b.doc));
}

const sentenceSetKey = (sentences: readonly string[]): string => [...sentences].sort().join('\0');
