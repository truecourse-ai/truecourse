/**
 * File format for the verifier store under `<repo>/.truecourse/verifier/`.
 * Mirrors the analysis store (`types/snapshot.ts`) but carries drift-shaped
 * data: there's no graph and no LLM usage/cost because verify produces
 * `ContractDrift[]` deterministically from contracts + code.
 */

import type { ContractDrift, Severity } from '@truecourse/contract-verifier';

export type DriftSeverityCounts = Record<Severity, number>;

/** A full per-run snapshot, stored at `verifier/runs/<iso>_<uuid>.json`. */
export interface VerifyRunSnapshot {
  id: string;
  verifiedAt: string;
  branch: string | null;
  commitHash: string | null;
  contractsDir: string;
  codeDir: string;
  artifactCount: number;
  extractedOperationCount: number;
  drifts: ContractDrift[];
  resolverErrors: string[];
  unresolvedRefs: string[];
}

/**
 * Materialized current verify state + diff baseline, at `verifier/LATEST.json`.
 * A superset of the legacy `VerifyState` shape so dashboard consumers keep
 * working through the migration.
 */
export interface VerifyLatest {
  /** Filename of the run this view was built from. */
  head: string;
  run: {
    id: string;
    verifiedAt: string;
    branch: string | null;
    commitHash: string | null;
    contractsDir: string;
    codeDir: string;
  };
  artifactCount: number;
  extractedOperationCount: number;
  drifts: ContractDrift[];
  resolverErrors: string[];
  unresolvedRefs: string[];
  summary: { total: number; bySeverity: DriftSeverityCounts };
}

export type ChangedFile = { path: string; status: 'new' | 'modified' | 'deleted' };

/** Current-vs-baseline drift diff, at `verifier/diff.json`. */
export interface VerifyDiff {
  id: string;
  /** The LATEST run this diff was computed against. */
  baseRunId: string;
  verifiedAt: string;
  branch: string | null;
  commitHash: string | null;
  /** Drifts present now but not in the baseline (by obligation key). */
  added: ContractDrift[];
  /** Drifts in the baseline but no longer present. */
  resolved: ContractDrift[];
  unchangedCount: number;
  /** Uncommitted working-tree changes (git status) behind this diff. */
  changedFiles: ChangedFile[];
  summary: { added: number; resolved: number; unchanged: number };
}

export interface VerifyHistoryEntry {
  id: string;
  filename: string;
  verifiedAt: string;
  branch: string | null;
  commitHash: string | null;
  artifactCount: number;
  driftCount: number;
  bySeverity: DriftSeverityCounts;
}

export interface VerifyHistory {
  runs: VerifyHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stable identity for a drift across runs. `ContractDrift.id` is regenerated
 * every run, so diffs key on the obligation — the same
 * `Type:identity / obligationKey` form the `IL-DRIFT` markers use.
 *
 * Per-query drifts attributed to a SPECIFIC code query additionally carry a
 * site anchor (`@ <enclosingSymbol>#<occurrenceIndex>`), so two violations of
 * the same obligation at two different code sites stay distinct drifts and the
 * PR gate can flag new violating code. The anchor is the enclosing SYMBOL plus
 * an occurrence index — still NO raw line number, so it's stable under line
 * moves. Absence drifts (missing-required) carry no symbol and stay
 * obligation-level.
 */
export function driftKey(d: ContractDrift): string {
  const base = `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`;
  return d.enclosingSymbol ? `${base} @ ${d.enclosingSymbol}#${d.occurrenceIndex ?? 0}` : base;
}

export function emptySeverityCounts(): DriftSeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function summarizeDrifts(drifts: ContractDrift[]): { total: number; bySeverity: DriftSeverityCounts } {
  const bySeverity = emptySeverityCounts();
  for (const d of drifts) bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
  return { total: drifts.length, bySeverity };
}

/**
 * Diff a current drift set against a baseline, matched by `driftKey` (stable
 * across runs despite regenerated drift ids). All three counts are key-deduped
 * so they're mutually consistent: `added`/`resolved` count each unique key
 * once, and `unchangedCount` counts UNIQUE current keys present in the baseline
 * (not raw drifts — two current drifts collapsing to one key count once).
 */
export function diffDrifts(
  baseline: ContractDrift[],
  current: ContractDrift[],
): { added: ContractDrift[]; resolved: ContractDrift[]; unchangedCount: number } {
  const baselineByKey = new Map<string, ContractDrift>();
  for (const d of baseline) if (!baselineByKey.has(driftKey(d))) baselineByKey.set(driftKey(d), d);

  // Dedupe current by key first, then classify each unique key once.
  const currentByKey = new Map<string, ContractDrift>();
  for (const d of current) if (!currentByKey.has(driftKey(d))) currentByKey.set(driftKey(d), d);

  const added: ContractDrift[] = [];
  let unchangedCount = 0;
  for (const [k, d] of currentByKey) {
    if (baselineByKey.has(k)) unchangedCount++;
    else added.push(d);
  }
  const resolved: ContractDrift[] = [];
  for (const [k, d] of baselineByKey) if (!currentByKey.has(k)) resolved.push(d);
  return { added, resolved, unchangedCount };
}
