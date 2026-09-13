import { describe, expect, it } from 'vitest';
import type { AnalysisRule, FileAnalysis } from '@truecourse/shared';
import { routeContext } from '../../packages/core/src/services/llm/context-router.js';

describe('routeContext source scope', () => {
  it('retains the exact function ranges represented by a targeted batch', () => {
    const filePath = '/repo/src/orders.ts';
    const content = [
      'export async function placeOrder() {',
      '  return await saveOrder();',
      '}',
      '',
      'export function formatOrder() {',
      "  return 'formatted';",
      '}',
    ].join('\n');
    const fileAnalysis = {
      filePath,
      language: 'typescript',
      functions: [
        {
          name: 'placeOrder',
          isAsync: true,
          isExported: true,
          params: [],
          returnType: 'Promise<void>',
          location: { startLine: 1, endLine: 3 },
        },
        {
          name: 'formatOrder',
          isAsync: false,
          isExported: true,
          params: [],
          returnType: 'string',
          location: { startLine: 5, endLine: 7 },
        },
      ],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
      routeRegistrations: [],
    } as unknown as FileAnalysis;
    const rule = {
      key: 'reliability/llm/async-boundary',
      name: 'Async boundary',
      severity: 'high',
      prompt: 'Review async error handling.',
      category: 'code',
      type: 'llm',
      contextRequirement: {
        tier: 'targeted',
        fileFilter: { languages: ['typescript'] },
        functionFilter: { isAsync: true },
      },
    } as unknown as AnalysisRule;
    const excludedPath = '/repo/src/orders.py';
    const excludedAnalysis = {
      ...fileAnalysis,
      filePath: excludedPath,
      language: 'python',
    } as unknown as FileAnalysis;

    const batches = routeContext(
      [rule],
      [fileAnalysis, excludedAnalysis],
      new Map([
        [filePath, { content, lineCount: 7 }],
        [excludedPath, { content, lineCount: 7 }],
      ]),
    );

    expect(batches).toHaveLength(1);
    expect(batches[0].sources).toEqual([
      {
        path: filePath,
        selection: {
          kind: 'targeted',
          functions: [
            { name: 'placeOrder', startLine: 1, endLine: 3 },
          ],
        },
      },
    ]);
    expect(batches[0].content).toContain('placeOrder');
    expect(batches[0].content).not.toContain('formatOrder');
    expect(batches[0].content).not.toContain(excludedPath);
  });

  it('retains the exact files and fields represented by a metadata batch', () => {
    const filePath = '/repo/src/orders.ts';
    const fileAnalysis = {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [{ source: './db.js' }],
      exports: [],
      calls: [],
      httpCalls: [],
      routeRegistrations: [],
    } as unknown as FileAnalysis;
    const rule = {
      key: 'architecture/llm/import-boundary',
      name: 'Import boundary',
      severity: 'medium',
      prompt: 'Review import boundaries.',
      category: 'code',
      type: 'llm',
      contextRequirement: {
        tier: 'metadata',
        fileFilter: { languages: ['typescript'] },
        metadataFields: ['imports'],
      },
    } as unknown as AnalysisRule;
    const excludedPath = '/repo/src/orders.py';
    const excludedAnalysis = {
      ...fileAnalysis,
      filePath: excludedPath,
      language: 'python',
    } as unknown as FileAnalysis;

    const batches = routeContext(
      [rule],
      [fileAnalysis, excludedAnalysis],
      new Map([
        [filePath, { content: "import './db.js';\n", lineCount: 1 }],
        [excludedPath, { content: 'from db import save\n', lineCount: 1 }],
      ]),
    );

    expect(batches[0].sources).toEqual([
      {
        path: filePath,
        selection: { kind: 'metadata', fields: ['imports'] },
      },
    ]);
    expect(batches[0].content).not.toContain(excludedPath);
  });

  it('retains the exact files represented by a full-file batch', () => {
    const filePath = '/repo/src/orders.ts';
    const fileAnalysis = {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
      routeRegistrations: [],
    } as unknown as FileAnalysis;
    const rule = {
      key: 'reliability/llm/file-review',
      name: 'File review',
      severity: 'medium',
      prompt: 'Review this file.',
      category: 'code',
      type: 'llm',
      contextRequirement: {
        tier: 'full-file',
        fileFilter: { languages: ['typescript'] },
      },
    } as unknown as AnalysisRule;
    const excludedPath = '/repo/src/orders.py';
    const excludedAnalysis = {
      ...fileAnalysis,
      filePath: excludedPath,
      language: 'python',
    } as unknown as FileAnalysis;

    const batches = routeContext(
      [rule],
      [fileAnalysis, excludedAnalysis],
      new Map([
        [filePath, { content: 'export const order = 1;\n', lineCount: 1 }],
        [excludedPath, { content: 'order = 1\n', lineCount: 1 }],
      ]),
    );

    expect(batches[0].sources).toEqual([
      { path: filePath, selection: { kind: 'full-file' } },
    ]);
    expect(batches[0].content).not.toContain(excludedPath);
  });

  it('keeps each oversized split tied to only the sources it contains', () => {
    const firstPath = '/repo/src/first.ts';
    const secondPath = '/repo/src/second.ts';
    const fileAnalysis = (filePath: string) => ({
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
      routeRegistrations: [],
    }) as unknown as FileAnalysis;
    const rule = {
      key: 'reliability/llm/file-review',
      name: 'File review',
      severity: 'medium',
      prompt: 'Review this file.',
      category: 'code',
      type: 'llm',
      contextRequirement: { tier: 'full-file' },
    } as unknown as AnalysisRule;
    const largeSource = 'x'.repeat(60_000);

    const batches = routeContext(
      [rule],
      [fileAnalysis(firstPath), fileAnalysis(secondPath)],
      new Map([
        [firstPath, { content: largeSource, lineCount: 1 }],
        [secondPath, { content: largeSource, lineCount: 1 }],
      ]),
    );

    expect(batches).toHaveLength(2);
    for (const [index, path] of [firstPath, secondPath].entries()) {
      const otherPath = index === 0 ? secondPath : firstPath;
      expect(batches[index]).toEqual(expect.objectContaining({
        fileCount: 1,
        filePaths: [path],
        sources: [{ path, selection: { kind: 'full-file' } }],
      }));
      expect(batches[index].content).toContain(`=== ${path} ===`);
      expect(batches[index].content).not.toContain(`=== ${otherPath} ===`);
    }
  });

  it('keeps targeted scope and function counts aligned through oversized splits', () => {
    const firstPath = '/repo/src/first.ts';
    const secondPath = '/repo/src/second.ts';
    const largeBody = 'x'.repeat(60_000);
    const content = (name: string) => [
      `export async function ${name}() {`,
      `  return '${largeBody}';`,
      '}',
    ].join('\n');
    const fileAnalysis = (filePath: string, name: string) => ({
      filePath,
      language: 'typescript',
      functions: [{
        name,
        isAsync: true,
        isExported: true,
        params: [],
        returnType: 'Promise<string>',
        location: { startLine: 1, endLine: 3 },
      }],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
      routeRegistrations: [],
    }) as unknown as FileAnalysis;
    const rule = {
      key: 'reliability/llm/async-boundary',
      name: 'Async boundary',
      severity: 'high',
      prompt: 'Review async error handling.',
      category: 'code',
      type: 'llm',
      contextRequirement: {
        tier: 'targeted',
        functionFilter: { isAsync: true },
      },
    } as unknown as AnalysisRule;

    const batches = routeContext(
      [rule],
      [fileAnalysis(firstPath, 'first'), fileAnalysis(secondPath, 'second')],
      new Map([
        [firstPath, { content: content('first'), lineCount: 3 }],
        [secondPath, { content: content('second'), lineCount: 3 }],
      ]),
    );

    expect(batches).toHaveLength(2);
    for (const [index, [path, name]] of [
      [firstPath, 'first'],
      [secondPath, 'second'],
    ].entries()) {
      const otherPath = index === 0 ? secondPath : firstPath;
      expect(batches[index]).toEqual(expect.objectContaining({
        fileCount: 1,
        functionCount: 1,
        sources: [{
          path,
          selection: {
            kind: 'targeted',
            functions: [{ name, startLine: 1, endLine: 3 }],
          },
        }],
      }));
      expect(batches[index].content).toContain(`=== ${path} ===`);
      expect(batches[index].content).not.toContain(`=== ${otherPath} ===`);
    }
  });
});
