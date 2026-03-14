import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { FileAnalysis } from '../../packages/shared/src/types/analysis';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis, type SplitAnalysisResult } from '../../packages/analyzer/src/split-analyzer';

const FIXTURE_PATH = new URL('../fixtures/sample-project', import.meta.url).pathname;

describe('performSplitAnalysis with fixture project', () => {
  let analyses: FileAnalysis[];
  let result: SplitAnalysisResult;

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const fileAnalyses: FileAnalysis[] = [];
    for (const file of files) {
      const analysis = await analyzeFile(file);
      if (analysis) {
        fileAnalyses.push(analysis);
      }
    }
    analyses = fileAnalyses;
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    result = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
  });

  it("returns architecture 'microservices' for multi-service fixture", () => {
    expect(result.architecture).toBe('microservices');
  });

  it('returns 3 services matching fixture structure', () => {
    expect(result.services.length).toBe(3);
    const names = result.services.map((s) => s.name);
    expect(names).toContain('api-gateway');
    expect(names).toContain('user-service');
    expect(names).toContain('utils');
  });

  it('each service has correct fileCount', () => {
    for (const service of result.services) {
      expect(service.fileCount).toBeGreaterThan(0);
      expect(service.fileCount).toBe(
        analyses.filter((a) => service.files.includes(a.filePath)).length
      );
    }
  });

  it('each service has layers detected', () => {
    for (const service of result.services) {
      expect(service.layers.length).toBeGreaterThan(0);
      for (const layer of service.layers) {
        expect(layer).toHaveProperty('layer');
        expect(layer).toHaveProperty('confidence');
        expect(layer).toHaveProperty('evidence');
      }
    }
  });

  it('detects cross-service HTTP dependency from api-gateway to user-service', () => {
    const httpDep = result.dependencies.find(
      (d) => d.source === 'api-gateway' && d.target === 'user-service'
    );
    expect(httpDep).toBeDefined();
    expect(httpDep!.httpCalls).toBeDefined();
    expect(httpDep!.httpCalls!.length).toBeGreaterThan(0);
  });

  it('detects cross-service import dependency from api-gateway to utils', () => {
    const importDep = result.dependencies.find(
      (d) => d.source === 'api-gateway' && d.target === 'utils'
    );
    expect(importDep).toBeDefined();
    expect(importDep!.dependencies.length).toBeGreaterThan(0);
  });
});

describe('performSplitAnalysis with single-service project', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns architecture 'monolith' for a single-service project", async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'truecourse-split-'));

    const srcDir = join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'simple-app', version: '1.0.0' })
    );

    writeFileSync(
      join(srcDir, 'index.ts'),
      `import { helper } from './helper';
console.log(helper());`
    );

    writeFileSync(
      join(srcDir, 'helper.ts'),
      `export function helper() { return 'hello'; }`
    );

    const files = discoverFiles(tempDir);
    const analyses: FileAnalysis[] = [];
    for (const file of files) {
      const analysis = await analyzeFile(file);
      if (analysis) {
        analyses.push(analysis);
      }
    }

    const deps = buildDependencyGraph(analyses, tempDir);
    const result = performSplitAnalysis(tempDir, analyses, deps);

    expect(result.architecture).toBe('monolith');
    expect(result.services.length).toBe(1);
    expect(result.dependencies.length).toBe(0);
  });
});
