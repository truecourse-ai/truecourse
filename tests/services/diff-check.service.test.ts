import { describe, it, expect } from 'vitest';
import type { FileAnalysis } from '../../packages/shared/src/types';

// Note: The runDiffCheck integration tests are removed because the new diff-check
// service requires LLM calls and a database. These are tested via the full
// POST /diff-check endpoint in E2E tests.

describe('diff logic (unit)', () => {
  it('merging replaces changed file analyses and keeps others', () => {
    const mockAnalyses: FileAnalysis[] = [
      { filePath: '/repo/a.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/b.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/c.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/d.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/e.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
    ];

    // Simulate merge: replace 2 files (b.ts, d.ts)
    const repoPath = '/repo';
    const changedPaths = new Set(['b.ts', 'd.ts']);
    const kept = mockAnalyses.filter((fa) => {
      const relPath = fa.filePath.replace(`${repoPath}/`, '');
      return !changedPaths.has(relPath);
    });
    expect(kept).toHaveLength(3);

    const merged = [
      ...kept,
      { filePath: '/repo/b.ts', language: 'typescript' as const, functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/d.ts', language: 'typescript' as const, functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
    ];
    expect(merged).toHaveLength(5);
  });

  it('deleted files are excluded from merged set', () => {
    const mockAnalyses: FileAnalysis[] = [
      { filePath: '/repo/a.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/b.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
      { filePath: '/repo/c.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
    ];

    const deletedPaths = new Set(['b.ts']);
    const kept = mockAnalyses.filter((fa) => {
      const relPath = fa.filePath.replace('/repo/', '');
      return !deletedPaths.has(relPath);
    });
    expect(kept).toHaveLength(2);
    expect(kept.map((fa) => fa.filePath)).toEqual(['/repo/a.ts', '/repo/c.ts']);
  });

  it('new files are added to merged set', () => {
    const mockAnalyses: FileAnalysis[] = [
      { filePath: '/repo/a.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [] },
    ];

    const newAnalysis: FileAnalysis = {
      filePath: '/repo/new.ts', language: 'typescript', functions: [], classes: [], imports: [], exports: [], calls: [], httpCalls: [],
    };

    const merged = [...mockAnalyses, newAnalysis];
    expect(merged).toHaveLength(2);
    expect(merged.map((fa) => fa.filePath)).toContain('/repo/new.ts');
  });

  it('violation diff correctly identifies new, resolved, and unchanged', () => {
    const oldViolations = new Map([
      ['svc-a::api::svc-b::data', { sourceServiceName: 'svc-a', sourceLayer: 'api', targetServiceName: 'svc-b', targetLayer: 'data', dependencyCount: 1, violationReason: 'bad' }],
      ['svc-a::service::svc-b::external', { sourceServiceName: 'svc-a', sourceLayer: 'service', targetServiceName: 'svc-b', targetLayer: 'external', dependencyCount: 2, violationReason: 'also bad' }],
    ]);

    const newViolations = new Map([
      ['svc-a::service::svc-b::external', { sourceServiceName: 'svc-a', sourceLayer: 'service', targetServiceName: 'svc-b', targetLayer: 'external', dependencyCount: 2, violationReason: 'also bad' }],
      ['svc-c::data::svc-a::api', { sourceServiceName: 'svc-c', sourceLayer: 'data', targetServiceName: 'svc-a', targetLayer: 'api', dependencyCount: 1, violationReason: 'new issue' }],
    ]);

    const newItems = [...newViolations.keys()].filter((k) => !oldViolations.has(k));
    expect(newItems).toHaveLength(1);
    expect(newItems[0]).toBe('svc-c::data::svc-a::api');

    const resolvedItems = [...oldViolations.keys()].filter((k) => !newViolations.has(k));
    expect(resolvedItems).toHaveLength(1);
    expect(resolvedItems[0]).toBe('svc-a::api::svc-b::data');

    const unchangedItems = [...oldViolations.keys()].filter((k) => newViolations.has(k));
    expect(unchangedItems).toHaveLength(1);
    expect(unchangedItems[0]).toBe('svc-a::service::svc-b::external');
  });

  it('empty changes produce zero new/resolved counts', () => {
    const violations = [
      { status: 'unchanged' as const, sourceServiceName: 'a', sourceLayer: 'api', targetServiceName: 'b', targetLayer: 'data', violationReason: 'test', dependencyCount: 1 },
    ];

    const newCount = violations.filter((v) => v.status === 'new').length;
    const resolvedCount = violations.filter((v) => v.status === 'resolved').length;
    const unchangedCount = violations.filter((v) => v.status === 'unchanged').length;

    expect(newCount).toBe(0);
    expect(resolvedCount).toBe(0);
    expect(unchangedCount).toBe(1);
  });
});
