import { describe, expect, it } from 'vitest';
import type { LlmTransport } from '@truecourse/shared/llm';
import { BaseCLIProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import type { CodeViolationContext } from '../../packages/core/src/services/llm/provider.js';

class CodeResultProvider extends BaseCLIProvider {
  get binaryName() {
    return 'claude';
  }

  get baseArgs() {
    return ['-p', '--output-format', 'json'];
  }

  get modelFlag() {
    return ['--model', 'test-model'];
  }
}

const rule = {
  key: 'security/llm/no-eval',
  name: 'No eval',
  severity: 'high',
  prompt: 'Report unsafe eval calls.',
};

const violation = {
  ruleKey: rule.key,
  filePath: '/repo/a.ts',
  lineStart: 2,
  lineEnd: 2,
  severity: 'high',
  title: 'Unsafe `eval` call',
  content: '`eval` executes untrusted input.',
  fixPrompt: null,
};

function providerReturning(output: unknown): CodeResultProvider {
  const transport: LlmTransport = async () => JSON.stringify(output);
  return new CodeResultProvider(transport);
}

function fullFileContext(): CodeViolationContext {
  return {
    files: [{ path: '/repo/a.ts', content: 'const a = 1;\neval(input);\nreturn a;' }],
    sourceScopes: [{ path: '/repo/a.ts', ranges: [{ lineStart: 1, lineEnd: 3 }] }],
    llmRules: [rule],
    tier: 'full-file',
  };
}

describe('code-result ownership certification', () => {
  it('accepts a finding owned by the originating rule, source, and range', async () => {
    const result = await providerReturning({ violations: [violation] })
      .generateCodeViolations(fullFileContext());

    expect(result.violations).toEqual([{ ...violation, sourceTier: 'full-file' }]);
  });

  it('rejects a duplicate new finding instead of persisting it twice', async () => {
    await expect(providerReturning({ violations: [violation, { ...violation }] })
      .generateCodeViolations(fullFileContext()))
      .rejects.toThrow(/same new finding more than once/i);
  });

  it('rejects a rule key that was not assigned to the originating batch', async () => {
    const output = {
      violations: [{ ...violation, ruleKey: 'reliability/llm/no-retry' }],
    };

    await expect(providerReturning(output).generateCodeViolations(fullFileContext()))
      .rejects.toThrow(/rule.*originating batch/i);
  });

  it('rejects a source path owned by a different batch', async () => {
    const output = {
      violations: [{ ...violation, filePath: '/repo/b.ts' }],
    };

    await expect(providerReturning(output).generateCodeViolations(fullFileContext()))
      .rejects.toThrow(/source.*originating batch/i);
  });

  it('rejects a line range outside the originating source scope', async () => {
    const output = {
      violations: [{ ...violation, lineStart: 3, lineEnd: 4 }],
    };

    await expect(providerReturning(output).generateCodeViolations(fullFileContext()))
      .rejects.toThrow(/range.*originating batch/i);
  });

  it.each([
    { name: 'fractional', lineStart: 1.5, lineEnd: 2 },
    { name: 'non-positive', lineStart: 0, lineEnd: 2 },
  ])('rejects $name line coordinates before ownership certification', async ({ lineStart, lineEnd }) => {
    const output = {
      violations: [{ ...violation, lineStart, lineEnd }],
    };

    await expect(providerReturning(output).generateCodeViolations(fullFileContext()))
      .rejects.toThrow();
  });

  it('rejects a reversed line range', async () => {
    const output = {
      violations: [{ ...violation, lineStart: 3, lineEnd: 2 }],
    };

    await expect(providerReturning(output).generateCodeViolations(fullFileContext()))
      .rejects.toThrow(/range.*originating batch/i);
  });

  it('rejects a range spanning two separately supplied targeted functions', async () => {
    const context: CodeViolationContext = {
      files: [{ path: 'context', content: '=== /repo/a.ts ===\n10: first();\n20: second();' }],
      sourceScopes: [{
        path: '/repo/a.ts',
        ranges: [
          { lineStart: 10, lineEnd: 12 },
          { lineStart: 20, lineEnd: 25 },
        ],
      }],
      llmRules: [rule],
      tier: 'targeted',
    };
    const output = {
      violations: [{ ...violation, lineStart: 12, lineEnd: 20 }],
    };

    await expect(providerReturning(output).generateCodeViolations(context))
      .rejects.toThrow(/range.*originating batch/i);
  });

  it('requires metadata findings to use the supplied file-level bounds', async () => {
    const context: CodeViolationContext = {
      files: [{ path: 'context', content: '=== /repo/a.ts (lines 1-30) ===\nImports: node:fs' }],
      sourceScopes: [{ path: '/repo/a.ts', ranges: [{ lineStart: 1, lineEnd: 30 }] }],
      llmRules: [rule],
      tier: 'metadata',
    };
    const fabricatedNarrowRange = {
      violations: [{ ...violation, lineStart: 10, lineEnd: 12 }],
    };

    await expect(providerReturning(fabricatedNarrowRange).generateCodeViolations(context))
      .rejects.toThrow(/range.*originating batch/i);

    const accepted = await providerReturning({
      violations: [{ ...violation, lineStart: 1, lineEnd: 30 }],
    }).generateCodeViolations(context);
    expect(accepted.violations[0]).toMatchObject({ lineStart: 1, lineEnd: 30 });
  });
});

describe('code lifecycle ownership certification', () => {
  function lifecycleContext(): CodeViolationContext {
    return {
      ...fullFileContext(),
      existingViolations: [
        {
          id: 'real-1',
          filePath: '/repo/a.ts',
          lineStart: 1,
          lineEnd: 1,
          ruleKey: rule.key,
          severity: 'high',
          title: 'First prior finding',
          content: 'First prior finding content.',
        },
        {
          id: 'real-2',
          filePath: '/repo/a.ts',
          lineStart: 3,
          lineEnd: 3,
          ruleKey: rule.key,
          severity: 'high',
          title: 'Second prior finding',
          content: 'Second prior finding content.',
        },
      ],
    };
  }

  it('accepts an exact prior-ID partition and rebinds prompt IDs', async () => {
    const output = {
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-1'],
      newViolations: [],
    };

    const result = await providerReturning(output).generateCodeViolations(lifecycleContext());

    expect(result.resolvedViolationIds).toEqual(['real-1']);
    expect(result.unchangedViolationIds).toEqual(['real-2']);
  });

  it.each([
    {
      name: 'an unknown ID',
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-99'],
    },
    {
      name: 'an omitted ID',
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: [],
    },
    {
      name: 'an ID in both outcomes',
      resolvedViolationIds: ['cv-0', 'cv-1'],
      unchangedViolationIds: ['cv-1'],
    },
    {
      name: 'a duplicate ID',
      resolvedViolationIds: ['cv-0', 'cv-0'],
      unchangedViolationIds: ['cv-1'],
    },
  ])('rejects $name instead of accepting an ambiguous lifecycle result', async (output) => {
    await expect(providerReturning({ ...output, newViolations: [] })
      .generateCodeViolations(lifecycleContext()))
      .rejects.toThrow(/exact partition/i);
  });

  it.each([
    {
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-1'],
    },
    {
      resolvedViolationIds: ['cv-1'],
      unchangedViolationIds: ['cv-0'],
    },
  ])('rejects a prior finding reintroduced as new regardless of its classification', async (partition) => {
    const duplicatePrior = {
      ...violation,
      lineStart: 1,
      lineEnd: 1,
      title: 'First prior finding',
    };

    await expect(providerReturning({
      ...partition,
      newViolations: [duplicatePrior],
    }).generateCodeViolations(lifecycleContext()))
      .rejects.toThrow(/reintroduce.*same finding/i);
  });

  it('allows the same rule and title at a distinct full-file location', async () => {
    const result = await providerReturning({
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-1'],
      newViolations: [{ ...violation, title: 'First prior finding' }],
    }).generateCodeViolations(lifecycleContext());

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ lineStart: 2, title: 'First prior finding' });
  });

  it('rejects a legacy narrow metadata prior reintroduced as the same file-level finding', async () => {
    const context: CodeViolationContext = {
      ...lifecycleContext(),
      files: [{ path: 'context', content: '=== /repo/a.ts (lines 1-3) ===\nImports: node:fs' }],
      sourceScopes: [{ path: '/repo/a.ts', ranges: [{ lineStart: 1, lineEnd: 3 }] }],
      tier: 'metadata',
    };

    await expect(providerReturning({
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-1'],
      newViolations: [{
        ...violation,
        lineStart: 1,
        lineEnd: 3,
        title: 'First prior finding',
      }],
    }).generateCodeViolations(context))
      .rejects.toThrow(/reintroduce.*same finding/i);
  });

  it('rejects duplicate new findings in lifecycle mode too', async () => {
    await expect(providerReturning({
      resolvedViolationIds: ['cv-0'],
      unchangedViolationIds: ['cv-1'],
      newViolations: [violation, { ...violation }],
    }).generateCodeViolations(lifecycleContext()))
      .rejects.toThrow(/same new finding more than once/i);
  });
});
