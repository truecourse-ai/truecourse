/**
 * ForbiddenArtifact comparator. For each spec-side
 * `forbidden-artifact <name>`, run the category's presence detector
 * against the code dir; emit a drift per match.
 *
 * Drift kind:
 *   forbidden.${category}.${pattern}.present   high (critical for env-var bypass)
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  ForbiddenArtifactContract,
  Severity,
  SpecOrigin,
} from '../types/index.js';
import {
  detectForbiddenFiles,
  detectForbiddenEnvVar,
  detectForbiddenDependency,
  detectForbiddenFeatureFlag,
  type ForbiddenMatch,
} from '../extractor/forbidden/index.js';

export interface ForbiddenArtifactCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: ForbiddenArtifactContract;
  /** Code dir to scan. */
  codeDir: string;
}

export async function compareForbiddenArtifact(
  input: ForbiddenArtifactCompareInput,
): Promise<ContractDrift[]> {
  const { ref, origin, contract, codeDir } = input;
  const { category, pattern, reason } = contract;

  const matches = await runDetector(category, codeDir, pattern);
  if (matches.length === 0) return [];

  const severity: Severity = severityFor(category, pattern);
  return matches.map((m) => ({
    id: randomUUID(),
    type: 'contract-drift' as const,
    artifactRef: ref,
    obligationKey: `forbidden.${category}.${pattern}.present`,
    severity,
    filePath: m.filePath,
    lineStart: m.lineStart ?? 0,
    lineEnd: m.lineEnd ?? 0,
    message: `Spec forbids ${category} \`${pattern}\` but code has it. ${reason}`.trim(),
    specSide: `forbidden ${category} ${pattern}`,
    codeSide: m.snippet ?? m.filePath,
    specOrigin: origin ?? undefined,
  }));
}

async function runDetector(
  category: ForbiddenArtifactContract['category'],
  codeDir: string,
  pattern: string,
): Promise<ForbiddenMatch[]> {
  switch (category) {
    case 'file-glob':    return detectForbiddenFiles(codeDir, pattern);
    case 'env-var':      return detectForbiddenEnvVar(codeDir, pattern);
    case 'dependency':   return detectForbiddenDependency(codeDir, pattern);
    case 'feature-flag': return detectForbiddenFeatureFlag(codeDir, pattern);
  }
}

/**
 * Severity escalation: env-var auth bypasses (anything matching
 * `*BYPASS*`, `*DISABLE*AUTH*`, `*SKIP*AUTH*`) are critical; other
 * forbidden presence is high.
 */
function severityFor(category: ForbiddenArtifactContract['category'], pattern: string): Severity {
  if (category === 'env-var' && /BYPASS|DISABLE.*AUTH|SKIP.*AUTH/i.test(pattern)) {
    return 'critical';
  }
  return 'high';
}
