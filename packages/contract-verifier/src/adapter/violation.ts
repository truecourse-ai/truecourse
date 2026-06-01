/**
 * Adapter — `ContractDrift` → the persisted violation shape consumed by
 * `truecourse analyze` and `LATEST.json`.
 *
 * The adapter intentionally produces the framework-agnostic shape (a plain
 * object matching `ViolationRecord` from `@truecourse/core`) rather than
 * importing core types here, so this package stays cycle-free. Core's
 * pipeline picks the result up and inserts it into the run's violation
 * stream alongside rule-engine output.
 *
 * `ruleKey` is the stable identifier the diff layer keys on — it must be
 * deterministic for the same drift across runs so `--diff` can match
 * "same drift, still present" between baseline and current.
 */

import type { ContractDrift } from '../types/index.js';

/**
 * Plain-object shape this adapter emits. Mirrors the persisted
 * `ViolationRecord` minus snapshot-specific fields the orchestrator fills
 * in (firstSeenAnalysisId, previousViolationId, status). The orchestrator
 * is responsible for stamping `createdAt`, `firstSeenAt`, etc. when it
 * folds the record into the run.
 *
 * Fields are intentionally typed as the storage strings/null — not Zod —
 * so this package doesn't pull in Zod or core's snapshot types.
 */
export interface ContractDriftViolation {
  id: string;
  type: 'contract-drift';
  category: 'contract-drift';
  subcategory: string;                  // ArtifactKind ("Operation", …)
  title: string;
  content: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  ruleKey: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  /** Drifts don't carry column granularity yet — set null at storage time. */
  columnStart: null;
  columnEnd: null;
  snippet: null;
  /** Targets are graph IDs the dashboard uses for navigation. The pipeline
   *  enriches these by matching `filePath` against the discovered modules
   *  (same path it already takes for code-rule violations). */
  targetServiceId: null;
  targetModuleId: null;
  targetMethodId: null;
  targetDatabaseId: null;
  targetTable: null;
  fixPrompt: null;
}

/**
 * Map a single ContractDrift to the persisted violation shape.
 *
 *   ruleKey    = `contract-drift/<ArtifactKind>/<obligationKey>` — stable
 *                across runs, so the diff layer recognises an unchanged
 *                drift as `unchanged` rather than churning new+resolved.
 *
 *   subcategory = ArtifactKind  (lets users filter "show me StateMachine
 *                                drifts" without parsing ruleKey).
 *
 *   title       = "<ArtifactKind>:<identity> · <obligationKey>"
 *   content     = drift.message + spec/code side blurbs when present
 *
 * The orchestrator (core's pipeline) overlays `status`, `firstSeenAt`,
 * `firstSeenAnalysisId`, `previousViolationId`, `createdAt`, etc. — same
 * lifecycle treatment rule violations already get.
 */
export function driftToViolation(drift: ContractDrift): ContractDriftViolation {
  const artifactKey = `${drift.artifactRef.type}:${drift.artifactRef.identity}`;
  const ruleKey = `contract-drift/${drift.artifactRef.type}/${drift.obligationKey}`;

  const contentParts: string[] = [drift.message];
  if (drift.specSide) contentParts.push(`Spec: ${drift.specSide}`);
  if (drift.codeSide) contentParts.push(`Code: ${drift.codeSide}`);

  return {
    id: drift.id,
    type: 'contract-drift',
    category: 'contract-drift',
    subcategory: drift.artifactRef.type,
    title: `${artifactKey} · ${drift.obligationKey}`,
    content: contentParts.join('\n\n'),
    severity: drift.severity,
    ruleKey,
    filePath: drift.filePath,
    lineStart: drift.lineStart,
    lineEnd: drift.lineEnd,
    columnStart: null,
    columnEnd: null,
    snippet: null,
    targetServiceId: null,
    targetModuleId: null,
    targetMethodId: null,
    targetDatabaseId: null,
    targetTable: null,
    fixPrompt: null,
  };
}

/** Bulk variant — same map, applied to every drift in an array. */
export function driftsToViolations(drifts: ContractDrift[]): ContractDriftViolation[] {
  return drifts.map(driftToViolation);
}
