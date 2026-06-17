/**
 * Shared inferred-decision logic — used by the dashboard route (OSS + EE) and the
 * gate, over the swappable spec / contract / inferred-action stores. The source of
 * truth is the `inferredDecisions` spec artifact (written by `inferInProcess`); the
 * action overlay filters dismissed/promoted out and drives promotion into the
 * authored `contracts` set.
 */

import { loadSpec, loadLatestSpec, latestSpecCommit, type RepoRef } from './spec-store.js';
import { readContractFile, putContractFile } from './contract-store.js';
import {
  listInferredActions,
  setInferredAction,
  removeInferredAction,
  type InferredAction,
} from './inferred-action-store.js';

export interface InferredDecisionSummary {
  kind: string;
  identity: string;
  path?: string;
  line?: number;
  reason?: string;
  /** Extraction confidence (`high` | `medium` | `low`). */
  confidence?: string;
  /** The decision's rendered `.tc` — the full reverse-engineered contract (detail view). */
  tc?: string;
  /** The decision's `.tc` path in the `contracts_inferred` set (for promotion). */
  contractPath?: string;
}

const key = (d: { kind: string; identity: string }): string => `${d.kind} ${d.identity}`;

export interface InferDiff {
  /** Decisions on the head not present in the baseline (new undocumented decisions). */
  added: InferredDecisionSummary[];
  /** Same kind+identity in both, but the contract body changed (modified behavior). */
  changed: InferredDecisionSummary[];
  /** Baseline decisions no longer on the head (the PR documented/removed them). */
  resolved: InferredDecisionSummary[];
  /** No baseline set existed → `added` is the full head set, not a true delta. */
  fellBack: boolean;
}

/**
 * The `.tc` body with provenance/line lines stripped, so a moved code location or
 * reworded reason isn't counted as a content "change" — only the contract matters.
 */
function strippedTc(d: InferredDecisionSummary): string {
  return (d.tc ?? '')
    .split('\n')
    .filter(
      (l) =>
        !/^\s*\/\/ inferred — /.test(l) &&
        !/^\s*inferred-from "/.test(l) &&
        !/^\s*confidence (high|medium|low)\s*$/.test(l),
    )
    .join('\n')
    .trim();
}

/**
 * Diff a PR head's inferred decisions against the baseline set — keyed by
 * `(kind, identity)` (deterministic; the LLM `reason` is never part of the key).
 * `added` = new at head; `changed` = same identity, contract body differs;
 * `resolved` = gone at head (the gate uses this; the dashboard ignores it).
 */
export function diffDecisions(
  head: InferredDecisionSummary[],
  base: InferredDecisionSummary[] | null | undefined,
): InferDiff {
  if (base == null) return { added: head, changed: [], resolved: [], fellBack: true };
  const baseByKey = new Map(base.map((d) => [key(d), d]));
  const headKeys = new Set(head.map(key));
  const added: InferredDecisionSummary[] = [];
  const changed: InferredDecisionSummary[] = [];
  for (const d of head) {
    const b = baseByKey.get(key(d));
    if (!b) added.push(d);
    else if (strippedTc(d) !== strippedTc(b)) changed.push(d);
  }
  const resolved = base.filter((d) => !headKeys.has(key(d)));
  return { added, changed, resolved, fellBack: false };
}

/** Drop dismissed + promoted decisions (both are no longer "undocumented"). */
export function applyInferredActions(
  decisions: InferredDecisionSummary[],
  actions: InferredAction[],
): InferredDecisionSummary[] {
  if (actions.length === 0) return decisions;
  const actioned = new Set(actions.map(key));
  return decisions.filter((d) => !actioned.has(key(d)));
}

/**
 * Backfill the rendered `.tc` (detail view) and `confidence` (badge/filter) for
 * decisions inferred before those were stored inline, reading the canonical file
 * from the contracts_inferred set and parsing confidence off its provenance line.
 */
async function backfillTc(
  repoKey: string,
  commitSha: string | null,
  list: InferredDecisionSummary[],
): Promise<InferredDecisionSummary[]> {
  return Promise.all(
    list.map(async (d) => {
      if ((d.tc && d.confidence) || !d.contractPath) return d;
      const tc =
        d.tc ?? (await readContractFile(repoKey, 'contracts_inferred', d.contractPath, commitSha || undefined)) ?? undefined;
      if (tc == null) return d;
      const confidence = d.confidence ?? tc.match(/^\s*confidence\s+(high|medium|low)\s*$/m)?.[1];
      return { ...d, tc, confidence };
    }),
  );
}

/** The repo's CURRENT inferred decisions (latest stored), overlay-filtered. */
export async function readInferredDecisions(
  repoKey: string,
): Promise<{ decisions: InferredDecisionSummary[]; commitSha: string | null }> {
  const raw = (await loadLatestSpec<InferredDecisionSummary[]>(repoKey, 'inferredDecisions')) ?? [];
  const actions = await listInferredActions(repoKey);
  const commitSha = await latestSpecCommit(repoKey);
  const decisions = await backfillTc(repoKey, commitSha, applyInferredActions(raw, actions));
  return { decisions, commitSha };
}

/** Authored-contract paths that originated from a promoted inferred decision. */
export async function promotedContractPaths(repoKey: string): Promise<string[]> {
  const actions = await listInferredActions(repoKey);
  const promoted = new Set(actions.filter((a) => a.status === 'promoted').map(key));
  if (promoted.size === 0) return [];
  const raw = (await loadLatestSpec<InferredDecisionSummary[]>(repoKey, 'inferredDecisions')) ?? [];
  return raw.filter((d) => d.contractPath && promoted.has(key(d))).map((d) => d.contractPath!);
}

/** The decisions the user has DISMISSED — for the "Dismissed" view + restore. */
export async function readDismissedDecisions(repoKey: string): Promise<InferredDecisionSummary[]> {
  const actions = await listInferredActions(repoKey);
  const dismissed = new Set(actions.filter((a) => a.status === 'dismissed').map(key));
  if (dismissed.size === 0) return [];
  const raw = (await loadLatestSpec<InferredDecisionSummary[]>(repoKey, 'inferredDecisions')) ?? [];
  const commitSha = await latestSpecCommit(repoKey);
  return backfillTc(repoKey, commitSha, raw.filter((d) => dismissed.has(key(d))));
}

/** Restore a dismissed decision — drops the overlay action so it reappears. */
export async function undismissInferredDecision(
  repoKey: string,
  kind: string,
  identity: string,
): Promise<void> {
  await removeInferredAction(repoKey, kind, identity);
}

/**
 * Inferred decisions stored AT a specific ref, overlay-filtered — the gate diffs a
 * PR head against the baseline with this. `null` when nothing was inferred at the
 * ref (so the gate can fall back to the full head set).
 */
export async function readInferredDecisionsAt(ref: RepoRef): Promise<InferredDecisionSummary[] | null> {
  const raw = await loadSpec<InferredDecisionSummary[]>(ref, 'inferredDecisions');
  if (raw == null) return null;
  const actions = await listInferredActions(ref.repoKey);
  return applyInferredActions(raw, actions);
}

export async function dismissInferredDecision(
  repoKey: string,
  kind: string,
  identity: string,
): Promise<void> {
  await setInferredAction(repoKey, { kind, identity, status: 'dismissed', createdAt: new Date().toISOString() });
}

export type PromoteResult = 'ok' | 'not-found' | 'unavailable';

/**
 * Promote: write the decision's inferred `.tc` (which carries its provenance +
 * reason) into the authored `contracts` set so the gate enforces it, and record a
 * persistent `promoted` action. Reads the decision's `.tc` path from the latest
 * stored set.
 */
export async function promoteInferredDecision(
  repoKey: string,
  kind: string,
  identity: string,
): Promise<PromoteResult> {
  const raw = (await loadLatestSpec<InferredDecisionSummary[]>(repoKey, 'inferredDecisions')) ?? [];
  const decision = raw.find((d) => d.kind === kind && d.identity === identity);
  if (!decision?.contractPath) return 'not-found';
  const commitSha = (await latestSpecCommit(repoKey)) ?? '';
  const tc = await readContractFile(repoKey, 'contracts_inferred', decision.contractPath, commitSha || undefined);
  if (tc == null) return 'unavailable';
  await putContractFile({ repoKey, commitSha }, 'contracts', decision.contractPath, tc);
  await setInferredAction(repoKey, { kind, identity, status: 'promoted', createdAt: new Date().toISOString() });
  return 'ok';
}

/**
 * Re-apply promoted decisions into authored `contracts` after a (re)infer — a
 * regeneration rebuilds `contracts` from the spec and drops promoted artifacts, so
 * each promoted decision's `.tc` (from the fresh `contracts_inferred`) is rewritten
 * back. Best-effort per decision.
 */
export async function reapplyPromoted(
  ref: RepoRef,
  decisions: InferredDecisionSummary[],
): Promise<void> {
  const actions = await listInferredActions(ref.repoKey);
  const promoted = new Set(actions.filter((a) => a.status === 'promoted').map(key));
  if (promoted.size === 0) return;
  for (const d of decisions) {
    if (!d.contractPath || !promoted.has(key(d))) continue;
    const tc = await readContractFile(ref.repoKey, 'contracts_inferred', d.contractPath, ref.commitSha || undefined);
    if (tc != null) await putContractFile(ref, 'contracts', d.contractPath, tc);
  }
}
