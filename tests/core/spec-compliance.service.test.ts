import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/shared/src/types/spec-compliance';
import {
  type RunSpecComplianceOptions,
  runSpecComplianceAnalysis,
} from '../../packages/core/src/services/spec-compliance.service';
import { computeSpecComplianceViolationLifecycle } from '../../packages/core/src/services/spec-compliance-lifecycle.service';

const tempDirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'truecourse-spec-compliance-'));
  tempDirs.push(dir);
  return dir;
}

function writeFixture(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function writeProject(root: string): void {
  writeFixture(root, 'package.json', JSON.stringify({ dependencies: { express: '^4.18.0' } }, null, 2));
  writeFixture(root, 'src/server.ts', [
    "import express from 'express'",
    'const app = express()',
    "app.get('/health', (_req, res) => res.status(200).json({ ok: true }))",
  ].join('\n'));
  writeFixture(root, 'docs/openapi.yaml', [
    'openapi: 3.0.0',
    'paths:',
    '  /health:',
    '    get:',
    '      summary: Health check',
    '      responses:',
    '        "200":',
    '          description: OK',
  ].join('\n'));
}

function mockProvider(): Required<RunSpecComplianceOptions>['provider'] & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    model: 'spec-compliance-service-cache-test',
    calls,
    async extractProseRequirements(input: unknown) {
      calls.push(input);
      return {
        requirements: [
          {
            kind: 'api',
            modality: 'must',
            subject: 'health route',
            action: 'expose',
            object: 'GET /health',
            constraints: [],
            evidenceText: 'The health route must expose GET /health.',
            confidence: 0.95,
          },
        ],
      };
    },
  };
}

function withoutTimings<T extends { metrics?: { timingsMs?: unknown } }>(artifact: T): T {
  return {
    ...artifact,
    metrics: artifact.metrics ? { ...artifact.metrics, timingsMs: {} } : artifact.metrics,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('runSpecComplianceAnalysis', () => {
  it('orchestrates discovery, structured requirements, code facts, and matchers deterministically', async () => {
    const root = tempProject();
    writeProject(root);

    const first = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/openapi.yaml'],
      noLlm: true,
      showSatisfied: true,
    });
    const second = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/openapi.yaml'],
      noLlm: true,
      showSatisfied: true,
    });

    expect(first.manifest.files).toHaveLength(1);
    expect(first.requirements).toHaveLength(1);
    expect(first.facts.some((fact) => fact.kind === 'api.route')).toBe(true);
    expect(first.results.map((result) => result.status)).toEqual(['satisfied']);
    expect(first.metrics.cache).toMatchObject({
      requirementCacheHits: 0,
      requirementCacheMisses: 0,
      skippedProseChunks: 0,
      llmCallCount: 0,
    });
    expect(Object.keys(first.metrics.timingsMs)).toEqual([
      'specDiscovery',
      'requirementExtraction',
      'factExtraction',
      'matching',
      'findingConversion',
      'total',
    ]);
    expect(canonicalJson(withoutTimings(second))).toBe(canonicalJson(withoutTimings(first)));
  });

  it('no-LLM mode skips prose extraction but keeps structured requirements, facts, and matchers', async () => {
    const root = tempProject();
    writeProject(root);
    writeFixture(root, 'docs/prose.md', '# Product\n\nUsers must sign in before checkout.\n');

    const artifact = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/**'],
      noLlm: true,
    });

    expect(artifact.requirements).toHaveLength(1);
    expect(artifact.errors.some((error) => error.message.includes('LLM extraction is disabled'))).toBe(true);
    expect(artifact.facts.length).toBeGreaterThan(0);
    expect(artifact.results).toHaveLength(1);
  });

  it('reports prose requirement cache hits and stable results across identical service runs', async () => {
    const root = tempProject();
    writeFixture(root, 'package.json', JSON.stringify({ dependencies: { express: '^4.18.0' } }, null, 2));
    writeFixture(root, 'src/server.ts', [
      "import express from 'express'",
      'const app = express()',
      "app.get('/health', (_req, res) => res.status(200).json({ ok: true }))",
    ].join('\n'));
    writeFixture(root, 'docs/product.md', '# Product\n\nThe health route must expose GET /health.\n');

    const firstProvider = mockProvider();
    const first = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/product.md'],
      provider: firstProvider,
      showSatisfied: true,
    });
    const secondProvider = mockProvider();
    const second = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/product.md'],
      provider: secondProvider,
      showSatisfied: true,
    });

    expect(firstProvider.calls).toHaveLength(1);
    expect(secondProvider.calls).toHaveLength(0);
    expect(first.metrics.cache).toMatchObject({
      requirementCacheHits: 0,
      requirementCacheMisses: 1,
      llmCallCount: 1,
    });
    expect(second.metrics.cache).toMatchObject({
      requirementCacheHits: 1,
      requirementCacheMisses: 0,
      llmCallCount: 0,
    });
    expect(second.requirements).toEqual(first.requirements);
    expect(second.results).toEqual(first.results);
  });
});

describe('computeSpecComplianceViolationLifecycle', () => {
  it('marks spec findings unchanged and resolved across repeated analyses by stable finding id', async () => {
    const root = tempProject();
    writeProject(root);
    const artifact = await runSpecComplianceAnalysis(root, {
      enabled: true,
      specs: ['docs/openapi.yaml'],
      noLlm: true,
      showSatisfied: true,
    });

    const first = computeSpecComplianceViolationLifecycle({
      analysisId: 'analysis-1',
      now: '2026-05-14T00:00:00.000Z',
      findings: artifact.findings,
      previousActiveViolations: [],
    });
    const previousActive = first.added.map((violation) => ({
      ...violation,
      targetServiceName: null,
      targetModuleName: null,
      targetMethodName: null,
      targetDatabaseName: null,
    }));

    const second = computeSpecComplianceViolationLifecycle({
      analysisId: 'analysis-2',
      now: '2026-05-14T01:00:00.000Z',
      findings: artifact.findings,
      previousActiveViolations: previousActive,
    });
    const third = computeSpecComplianceViolationLifecycle({
      analysisId: 'analysis-3',
      now: '2026-05-14T02:00:00.000Z',
      findings: [],
      previousActiveViolations: previousActive,
    });

    expect(first.added).toHaveLength(1);
    expect(second.unchanged).toHaveLength(1);
    expect(second.unchanged[0].previousViolationId).toBe(first.added[0].id);
    expect(third.resolvedRefs).toEqual([{ id: first.added[0].id, resolvedAt: '2026-05-14T02:00:00.000Z' }]);
  });
});
