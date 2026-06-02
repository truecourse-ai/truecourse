/**
 * Contract verification pipeline. Runs the deterministic contract verifier
 * over the project's `.tc` artifacts and the live source, maps the
 * resulting `ContractDrift[]` into the unified violation lifecycle, and
 * returns a `LifecycleResult` the orchestrator merges with rule-engine
 * output.
 *
 * No-ops cleanly when `.truecourse/contracts/` is absent — analyze runs
 * unchanged for projects that haven't adopted contract-driven verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { verify, driftsToViolations } from '@truecourse/contract-verifier';
import {
  computeFileViolationLifecycle,
  type ActiveViolation,
  type FileViolationInput,
  type LifecycleResult,
} from './violation-lifecycle.service.js';
import { log } from '../lib/logger.js';

export interface ContractPipelineParams {
  /** Repo root — `.truecourse/contracts/` lives here. */
  repoPath: string;
  analysisId: string;
  /** ISO timestamp shared with the rest of the analyze run. */
  now: string;
  /**
   * The previous-run violations carried into this run. Drifts only need
   * the contract-drift slice; the lifecycle service ignores rows it
   * doesn't recognise via ruleKey + filePath match.
   */
  previousActiveViolations: ActiveViolation[];
}

export interface ContractPipelineResult extends LifecycleResult {
  /** True when verification ran. False when no `.truecourse/contracts/` exists. */
  ran: boolean;
  /** Number of `.tc` artifacts the resolver indexed. Zero when skipped. */
  artifactCount: number;
  /** Resolver errors surfaced for the user. Empty when there were none. */
  resolverErrors: string[];
}

const CONTRACTS_SUBDIR = path.join('.truecourse', 'contracts');

export async function runContractPipeline(
  params: ContractPipelineParams,
): Promise<ContractPipelineResult> {
  const { repoPath, analysisId, now, previousActiveViolations } = params;

  const contractsDir = path.join(repoPath, CONTRACTS_SUBDIR);
  if (!fs.existsSync(contractsDir) || !fs.statSync(contractsDir).isDirectory()) {
    return emptyResult(false, 0, []);
  }

  const codeDir = autoDetectCodeDir(repoPath);

  let result: Awaited<ReturnType<typeof verify>>;
  try {
    result = await verify({ contractsDir, codeDir });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`[Contract] verifier crashed — skipping contract pipeline: ${message}`);
    return emptyResult(false, 0, [message]);
  }

  log.info(
    `[Contract] parsed ${result.artifactCount} artifacts, extracted ` +
      `${result.extractedOperationCount} operations → ${result.drifts.length} drifts`,
  );

  // Map drift output to FileViolationInput so the existing lifecycle
  // mechanism stamps firstSeenAt / status / previousViolationId across runs.
  const mapped = driftsToViolations(result.drifts);
  const currentViolations: FileViolationInput[] = mapped.map((m) => ({
    filePath: m.filePath,
    lineStart: m.lineStart,
    lineEnd: m.lineEnd,
    columnStart: 0,
    columnEnd: 0,
    ruleKey: m.ruleKey,
    severity: m.severity,
    title: m.title,
    content: m.content,
    snippet: '',
    category: 'contract-drift',
    subcategory: m.subcategory,
  }));

  // Only feed previous contract-drift rows into the lifecycle so the
  // matcher can't accidentally cross-resolve a rule violation as a drift
  // (or vice-versa) when ruleKeys collide.
  const previousDrifts = previousActiveViolations.filter(
    (v) => (v.category ?? 'rule') === 'contract-drift',
  );

  const lifecycle = computeFileViolationLifecycle({
    analysisId,
    now,
    currentViolations,
    previousViolations: previousDrifts,
  });

  return {
    ...lifecycle,
    ran: true,
    artifactCount: result.artifactCount,
    resolverErrors: result.resolverErrors,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function autoDetectCodeDir(repoDir: string): string {
  const src = path.join(repoDir, 'src');
  if (fs.existsSync(src) && fs.statSync(src).isDirectory()) return src;
  return repoDir;
}

function emptyResult(
  ran: boolean,
  artifactCount: number,
  resolverErrors: string[],
): ContractPipelineResult {
  return {
    added: [],
    unchanged: [],
    resolved: [],
    resolvedRefs: [],
    counts: { newCount: 0, unchangedCount: 0, resolvedCount: 0 },
    ran,
    artifactCount,
    resolverErrors,
  };
}
