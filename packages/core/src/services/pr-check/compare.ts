/**
 * THE COMPARISON a pull request check is judged by: the head's run against the
 * base's, the head's corpus against the workspace's, the head's manifest
 * against the base's. Pure — every input is a stored artifact the job read
 * before, so a control run or a rerun can be put in front of it later without
 * touching it.
 */

import {
  disputeKey,
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

function deltaKind(
  base: GuardCoveragePlainStatus | null,
  head: GuardCoveragePlainStatus | null,
): FlowDeltaKind {
  if (head === null) return 'retired';
  if (head === 'failed') return base === 'failed' ? 'pre-existing' : 'new-failure';
  if (base === null) return 'added';
  if (base === 'failed') return head === 'succeeded' ? 'fixed' : 'unchanged';
  if (base === 'succeeded' && head === 'blocked') return 'newly-blocked';
  return 'unchanged';
}

/**
 * The open conflicts of the head's corpus that the workspace's corpus does not
 * carry, by dispute identity (the doc pair and each side's section anchor).
 * The workspace corpus is its CURRENT one: a corpus has no commit dimension.
 */
export function conflictsCreated<O extends CorpusConflict>(
  defaultCorpus: CorpusLike | null,
  prConflicts: readonly O[],
  decisions: DecisionsLike,
): O[] {
  const known = new Set(
    (defaultCorpus ? openConflicts(defaultCorpus, decisions) : []).map((c) =>
      disputeKey(c.a, c.b, c.sections),
    ),
  );
  return prConflicts.filter((c) => !known.has(disputeKey(c.a, c.b, c.sections)));
}

export interface SectionMoved {
  doc: string;
  anchor: string;
  /** The flows bound to the section at the head. */
  flowIds: string[];
}

/**
 * The sections both manifests bind whose text fingerprint differs between
 * them — the sections the pull request changed — each with the flows that
 * read it, which go stale with it.
 */
export function sectionsMoved(base: GuardManifest | null, head: GuardManifest | null): SectionMoved[] {
  // Every fingerprint the base bound a section under: two base flows can hold
  // the same section at different fingerprints (one kept, one re-authored).
  const before = new Map<string, Set<string>>();
  for (const flow of base?.flows ?? []) {
    for (const binding of flow.bindings) {
      const key = sectionKey(binding.doc, binding.anchor);
      before.set(key, (before.get(key) ?? new Set()).add(binding.fingerprint));
    }
  }
  const moved = new Map<string, SectionMoved>();
  for (const flow of head?.flows ?? []) {
    for (const binding of flow.bindings) {
      const key = sectionKey(binding.doc, binding.anchor);
      const was = before.get(key);
      if (was === undefined || was.has(binding.fingerprint)) continue;
      const entry = moved.get(key) ?? { doc: binding.doc, anchor: binding.anchor, flowIds: [] };
      if (!entry.flowIds.includes(flow.flowId)) entry.flowIds.push(flow.flowId);
      moved.set(key, entry);
    }
  }
  return [...moved.values()].sort((a, b) => sectionKey(a.doc, a.anchor).localeCompare(sectionKey(b.doc, b.anchor)));
}

const sectionKey = (doc: string, anchor: string): string => `${doc}\0${anchor}`;
