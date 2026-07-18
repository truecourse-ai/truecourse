import { describe, expect, it } from 'vitest';
import {
  aggregateCodeBatchOutcomes,
  buildLlmCodeSnippet,
  codeDomainViolationTotal,
  hasCodeLifecycleResults,
  isPreviousCodeViolationOwnedByBatch,
  reconcileCodePriorClassifications,
} from '../../packages/core/src/services/violation-pipeline.service.js';
import type { CodeViolationContext, CodeViolationRaw } from '../../packages/core/src/services/llm/provider.js';
import type { ActiveViolation } from '../../packages/core/src/services/violation-lifecycle.service.js';

const sourceScopes = [{ path: '/repo/a.ts', ranges: [{ lineStart: 10, lineEnd: 20 }] }];

const prior = {
  id: 'prior-1',
  ruleKey: 'security/llm/no-eval',
  filePath: '/repo/a.ts',
  lineStart: 12,
  lineEnd: 13,
} as ActiveViolation;

describe('code batch lifecycle ownership', () => {
  it('assigns a prior only when its exact rule and complete source range belong to the batch', () => {
    expect(isPreviousCodeViolationOwnedByBatch(
      prior,
      new Set(['security/llm/no-eval']),
      sourceScopes,
    )).toBe(true);

    expect(isPreviousCodeViolationOwnedByBatch(
      prior,
      new Set(['security/llm/no-secrets']),
      sourceScopes,
    )).toBe(false);

    expect(isPreviousCodeViolationOwnedByBatch(
      { ...prior, lineStart: 9 },
      new Set(['security/llm/no-eval']),
      sourceScopes,
    )).toBe(false);
  });

  it('carries a rejected batch prior unchanged while retaining successful sibling results', () => {
    const existing = [{
      id: prior.id,
      filePath: prior.filePath!,
      lineStart: prior.lineStart!,
      lineEnd: prior.lineEnd!,
      ruleKey: prior.ruleKey,
      severity: 'high',
      title: 'Prior finding',
      content: 'Prior content',
    }];
    const batches: Pick<CodeViolationContext, 'existingViolations'>[] = [
      { existingViolations: existing },
      { existingViolations: undefined },
    ];
    const successfulViolation: CodeViolationRaw = {
      ruleKey: 'security/llm/no-secrets',
      filePath: '/repo/b.ts',
      lineStart: 4,
      lineEnd: 4,
      severity: 'high',
      title: 'Embedded secret',
      content: 'A secret is embedded in source.',
      fixPrompt: null,
    };
    const results: PromiseSettledResult<{
      violations: CodeViolationRaw[];
      resolvedViolationIds?: string[];
      unchangedViolationIds?: string[];
    }>[] = [
      { status: 'rejected', reason: new Error('ownership rejected') },
      { status: 'fulfilled', value: { violations: [successfulViolation] } },
    ];

    const aggregate = aggregateCodeBatchOutcomes(batches, results);

    expect(aggregate.violations).toEqual([successfulViolation]);
    expect(aggregate.resolvedIds).toEqual([]);
    expect(aggregate.unchangedIds).toEqual(['prior-1']);
    expect(aggregate.failures).toHaveLength(1);
  });

  it('treats an unchanged-only response as lifecycle work that must be persisted', () => {
    expect(hasCodeLifecycleResults([], [], ['prior-1'])).toBe(true);
  });

  it('preserves unclassified priors and lets unchanged win any cross-batch conflict', () => {
    expect(reconcileCodePriorClassifications(
      ['prior-1', 'prior-2', 'prior-3'],
      ['prior-1', 'prior-2'],
      ['prior-2'],
    )).toEqual({
      resolvedIds: ['prior-1'],
      unchangedIds: ['prior-2', 'prior-3'],
    });
  });

  it('counts active unchanged findings in the domain tracker total', () => {
    expect(codeDomainViolationTotal(2, 1, ['prior-1', 'prior-1', 'prior-2'])).toBe(5);
  });

  it('does not persist source snippets for metadata-only findings', () => {
    const wholeFile = 'first line\nsecret implementation\nlast line';

    expect(buildLlmCodeSnippet('metadata', wholeFile, 1, 3)).toBe('');
    expect(buildLlmCodeSnippet('targeted', wholeFile, 2, 2)).toBe('secret implementation');
  });
});
