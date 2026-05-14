import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type CodeFact,
  type ComplianceResult,
  type SourceRange,
} from '@truecourse/shared';
import type { SpecComplianceFinding } from './types.js';

function hash(prefix: string, value: unknown): string {
  return `${prefix}_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 12)}`;
}

function implementationSources(facts: CodeFact[]): Array<{ filePath: string; range?: SourceRange; factId?: string }> {
  return facts.map((fact) => ({
    filePath: fact.sourceFile,
    ...(fact.sourceRange ? { range: fact.sourceRange } : {}),
    factId: fact.id,
  }));
}

export function findingFromResult(resultValue: ComplianceResult): SpecComplianceFinding {
  const facts = [...resultValue.evidence.matchingFacts, ...resultValue.evidence.conflictingFacts];
  return {
    id: hash('finding', {
      requirementId: resultValue.requirementId,
      status: resultValue.status,
      matcher: resultValue.matcher,
      facts: facts.map((fact) => fact.id),
    }),
    title: `${resultValue.status}: ${resultValue.evidence.requirement.subject}`,
    message: resultValue.message,
    severity: resultValue.severity,
    status: resultValue.status,
    requirementId: resultValue.requirementId,
    ...(facts[0] ? { factId: facts[0].id } : {}),
    specSource: {
      filePath: resultValue.evidence.requirement.sourceFile,
      range: resultValue.evidence.requirement.sourceRange,
    },
    implementationSources: implementationSources(facts),
    matcher: resultValue.matcher,
    confidence: resultValue.evidence.requirement.confidence,
  };
}

export function unspecifiedFinding(fact: CodeFact): SpecComplianceFinding {
  return {
    id: hash('finding', { status: 'unspecified', factId: fact.id }),
    title: `unspecified: ${fact.kind}`,
    message: `Implementation fact "${fact.kind}" has no matching requirement.`,
    severity: 'info',
    status: 'unspecified',
    factId: fact.id,
    implementationSources: implementationSources([fact]),
    confidence: fact.confidence,
  };
}

export function unspecifiedFacts(results: ComplianceResult[], facts: CodeFact[]): CodeFact[] {
  const matchedFactIds = new Set(results.flatMap((resultValue) => [
    ...resultValue.evidence.matchingFacts.map((fact) => fact.id),
    ...resultValue.evidence.conflictingFacts.map((fact) => fact.id),
  ]));
  return facts.filter((fact) => ['api.route', 'ui.route', 'config.env'].includes(fact.kind) && !matchedFactIds.has(fact.id));
}

