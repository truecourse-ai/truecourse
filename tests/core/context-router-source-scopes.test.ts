import { describe, expect, it } from 'vitest';
import type { AnalysisRule, FileAnalysis } from '@truecourse/shared';
import { routeContext } from '../../packages/core/src/services/llm/context-router.js';

function ruleFor(tier: 'metadata' | 'targeted' | 'full-file'): AnalysisRule {
  return {
    key: `security/llm/${tier}`,
    name: `${tier} rule`,
    severity: 'high',
    prompt: `Check ${tier} input.`,
    contextRequirement: {
      tier,
      metadataFields: tier === 'metadata' ? ['imports'] : undefined,
    },
  } as AnalysisRule;
}

function fileAnalysis(path: string, functions: unknown[] = []): FileAnalysis {
  return {
    filePath: path,
    functions,
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
    routeRegistrations: [],
  } as unknown as FileAnalysis;
}

describe('context router source scopes', () => {
  it('records whole-file bounds for metadata batches', () => {
    const files = [fileAnalysis('/repo/a.ts'), fileAnalysis('/repo/b.ts')];
    const contents = new Map([
      ['/repo/a.ts', { content: 'a\n'.repeat(12), lineCount: 12 }],
      ['/repo/b.ts', { content: 'b\n'.repeat(7), lineCount: 7 }],
    ]);

    const [batch] = routeContext([ruleFor('metadata')], files, contents);

    expect(batch.sourceScopes).toEqual([
      { path: '/repo/a.ts', ranges: [{ lineStart: 1, lineEnd: 12 }] },
      { path: '/repo/b.ts', ranges: [{ lineStart: 1, lineEnd: 7 }] },
    ]);
  });

  it('records only the extracted function ranges for targeted batches', () => {
    const functions = [
      { name: 'first', location: { startLine: 10, endLine: 12 } },
      { name: 'second', location: { startLine: 20, endLine: 25 } },
    ];
    const files = [fileAnalysis('/repo/a.ts', functions)];
    const contents = new Map([
      ['/repo/a.ts', { content: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'), lineCount: 30 }],
    ]);

    const [batch] = routeContext([ruleFor('targeted')], files, contents);

    expect(batch.sourceScopes).toEqual([{
      path: '/repo/a.ts',
      ranges: [
        { lineStart: 10, lineEnd: 12 },
        { lineStart: 20, lineEnd: 25 },
      ],
    }]);
  });

  it('keeps each source scope attached to the correct oversized split batch', () => {
    const files = [fileAnalysis('/repo/a.ts'), fileAnalysis('/repo/b.ts')];
    const contents = new Map([
      ['/repo/a.ts', { content: 'a'.repeat(60_000), lineCount: 1 }],
      ['/repo/b.ts', { content: 'b'.repeat(60_000), lineCount: 1 }],
    ]);

    const batches = routeContext([ruleFor('full-file')], files, contents);

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.sourceScopes)).toEqual([
      [{ path: '/repo/a.ts', ranges: [{ lineStart: 1, lineEnd: 1 }] }],
      [{ path: '/repo/b.ts', ranges: [{ lineStart: 1, lineEnd: 1 }] }],
    ]);
  });
});
