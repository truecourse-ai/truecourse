import type { CodeFact, ComplianceResult, MatcherMetadata, Requirement } from '@truecourse/shared';
import { matcherMetadata, MATCHER_VERSION } from './result.js';
import type { ComplianceMatcher } from './types.js';

export function makeMatcher(
  name: string,
  supports: (requirement: Requirement) => boolean,
  evaluate: (input: { requirement: Requirement; facts: CodeFact[] }, metadata: MatcherMetadata) => ComplianceResult,
): ComplianceMatcher {
  return {
    name,
    version: MATCHER_VERSION,
    supports,
    evaluate(input) {
      return evaluate(input, matcherMetadata(name));
    },
  };
}

