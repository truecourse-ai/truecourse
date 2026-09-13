import { describe, expect, it } from 'vitest';
import {
  computeFileViolationLifecycle,
  type ActiveViolation,
} from '../../packages/core/src/services/violation-lifecycle.service';

describe('computeFileViolationLifecycle repeated findings', () => {
  const previousAt = (...lines: number[]): ActiveViolation[] => lines.map((line, index) => ({
    id: `prior-${index + 1}`,
    type: 'code',
    category: 'rule',
    subcategory: null,
    title: 'Environment access',
    content: 'process.env in non-config code',
    severity: 'medium',
    status: 'new',
    targetServiceId: null,
    targetDatabaseId: null,
    targetModuleId: null,
    targetMethodId: null,
    targetTable: null,
    relatedServiceId: null,
    relatedModuleId: null,
    fixPrompt: null,
    ruleKey: 'code-quality/deterministic/env-in-library-code',
    firstSeenAnalysisId: 'analysis-1',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    previousViolationId: null,
    resolvedAt: null,
    filePath: 'src/config.ts',
    lineStart: line,
    lineEnd: line,
    columnStart: 1,
    columnEnd: 12,
    snippet: 'process.env.VALUE',
    createdAt: '2026-01-01T00:00:00.000Z',
    targetServiceName: null,
    targetModuleName: null,
    targetMethodName: null,
    targetDatabaseName: null,
  }));

  const currentAt = (...lines: number[]) => lines.map((line) => ({
    filePath: 'src/config.ts',
    lineStart: line,
    lineEnd: line,
    columnStart: 1,
    columnEnd: 12,
    ruleKey: 'code-quality/deterministic/env-in-library-code',
    severity: 'medium',
    title: 'Environment access',
    content: 'process.env in non-config code',
    snippet: 'process.env.VALUE',
  }));

  const classify = (previous: ActiveViolation[], ...currentLines: number[]) =>
    computeFileViolationLifecycle({
      analysisId: 'analysis-2',
      now: '2026-01-02T00:00:00.000Z',
      previousViolations: previous,
      currentViolations: currentAt(...currentLines),
    });

  it('pairs repeated findings in one file with distinct prior lifecycle rows', () => {
    const result = classify(previousAt(10, 20), 10, 20);

    expect(result.added).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.unchanged).toHaveLength(2);
    expect(new Set(result.unchanged.map((violation) => violation.previousViolationId))).toEqual(
      new Set(['prior-1', 'prior-2']),
    );
  });

  it('reserves an exact old occurrence when a new earlier occurrence is inserted', () => {
    const result = classify(previousAt(10), 5, 10);

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]).toMatchObject({ previousViolationId: 'prior-1', lineStart: 10 });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ previousViolationId: null, lineStart: 5 });
    expect(result.resolved).toEqual([]);
  });

  it('resolves only the unmatched prior occurrence when one repeated finding disappears', () => {
    const result = classify(previousAt(10, 20), 20);

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]).toMatchObject({ previousViolationId: 'prior-2', lineStart: 20 });
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({ previousViolationId: 'prior-1', lineStart: 10 });
    expect(result.added).toEqual([]);
  });

  it('pairs moved repeated findings in stable order when no source span remains exact', () => {
    const result = classify(previousAt(10, 20), 30, 40);

    expect(result.unchanged.map((violation) => ({
      previousViolationId: violation.previousViolationId,
      lineStart: violation.lineStart,
    }))).toEqual([
      { previousViolationId: 'prior-1', lineStart: 30 },
      { previousViolationId: 'prior-2', lineStart: 40 },
    ]);
    expect(result.added).toEqual([]);
    expect(result.resolved).toEqual([]);
  });
});
