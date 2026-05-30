import {
  type CodeFact,
  type ComplianceResult,
  type ComplianceSeverity,
  type ComplianceStatus,
  type MatcherMetadata,
  type Requirement,
  type RequirementModality,
} from '@truecourse/shared';
import type { EvaluationEvidence } from './types.js';
import { sortCanonical } from './utils.js';

export const MATCHER_VERSION = '1.0.0';

export function matcherMetadata(name: string): MatcherMetadata {
  return { name, version: MATCHER_VERSION };
}

export function invertStatus(requirement: Requirement, matched: boolean, positiveMissingStatus: ComplianceStatus = 'missing'): ComplianceStatus {
  if (requirement.modality === 'must_not') return matched ? 'conflicting' : 'satisfied';
  return matched ? 'satisfied' : positiveMissingStatus;
}

export function severityFor(status: ComplianceStatus, modality: RequirementModality): ComplianceSeverity {
  if (status === 'satisfied') return 'info';
  if (status === 'ambiguous' || status === 'unverifiable') return modality === 'may' ? 'info' : 'warning';
  if (modality === 'must' || modality === 'must_not') return 'error';
  if (modality === 'should') return 'warning';
  return 'info';
}

export function complianceResult(
  requirement: Requirement,
  matcher: MatcherMetadata,
  status: ComplianceStatus,
  evidence: EvaluationEvidence,
): ComplianceResult {
  const matchingFacts = sortCanonical<CodeFact>(evidence.matchingFacts ?? []);
  const conflictingFacts = sortCanonical<CodeFact>(evidence.conflictingFacts ?? []);
  return {
    requirementId: requirement.id,
    status,
    severity: severityFor(status, requirement.modality),
    message: evidence.message,
    evidence: {
      requirement,
      matchingFacts,
      conflictingFacts,
    },
    matcher,
  };
}

