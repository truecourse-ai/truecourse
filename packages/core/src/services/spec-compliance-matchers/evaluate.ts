import type { CodeFact, ComplianceResult, Requirement } from '@truecourse/shared';
import { complianceMatchers } from './matchers.js';
import { findingFromResult, unspecifiedFacts, unspecifiedFinding } from './findings.js';
import { complianceResult, matcherMetadata } from './result.js';
import type { SpecComplianceFinding } from './types.js';
import { sortCanonical } from './utils.js';

function isAmbiguous(requirement: Requirement): boolean {
  return requirement.confidence < 0.55
    || (requirement.kind === 'unknown' && !requirement.object && requirement.constraints.length === 0);
}

function evaluateRequirement(requirement: Requirement, facts: CodeFact[]): ComplianceResult {
  if (isAmbiguous(requirement)) {
    return complianceResult(requirement, matcherMetadata('ambiguity.precheck'), 'ambiguous', {
      message: `Requirement "${requirement.subject}" is too ambiguous for deterministic matching.`,
    });
  }

  const matcher = complianceMatchers.find((candidate) => candidate.supports(requirement)) ?? complianceMatchers[complianceMatchers.length - 1]!;
  return matcher.evaluate({ requirement, facts });
}

export function evaluateSpecCompliance(input: {
  requirements: Requirement[];
  facts: CodeFact[];
  includeSatisfiedResults?: boolean;
  includeUnspecifiedFindings?: boolean;
}): { results: ComplianceResult[]; visibleResults: ComplianceResult[]; findings: SpecComplianceFinding[] } {
  const results = sortCanonical(input.requirements.map((requirement) => evaluateRequirement(requirement, input.facts)));
  const visibleResults = sortCanonical(input.includeSatisfiedResults ? results : results.filter((resultValue) => resultValue.status !== 'satisfied'));
  const resultFindings = visibleResults.map(findingFromResult);
  const implementationFindings = input.includeUnspecifiedFindings
    ? unspecifiedFacts(results, input.facts).map(unspecifiedFinding)
    : [];

  return {
    results,
    visibleResults,
    findings: sortCanonical([...resultFindings, ...implementationFindings]),
  };
}

