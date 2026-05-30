import type {
  CodeFact,
  ComplianceResult,
  ComplianceStatus,
  MatcherMetadata,
  Requirement,
  SourceRange,
} from '@truecourse/shared';

export interface ComplianceMatcher {
  name: string;
  version: string;
  supports(requirement: Requirement): boolean;
  evaluate(input: { requirement: Requirement; facts: CodeFact[] }): ComplianceResult;
}

export interface SpecComplianceFinding {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  status: ComplianceStatus | 'unspecified';
  requirementId?: string;
  factId?: string;
  specSource?: { filePath: string; range: SourceRange };
  implementationSources: Array<{ filePath: string; range?: SourceRange; factId?: string }>;
  matcher?: MatcherMetadata;
  confidence: number;
}

export interface EvaluationEvidence {
  matchingFacts?: CodeFact[];
  conflictingFacts?: CodeFact[];
  message: string;
}

