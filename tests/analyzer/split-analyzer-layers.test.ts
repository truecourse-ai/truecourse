import { describe, it, expect, beforeAll } from 'vitest';
import type { FileAnalysis } from '../../packages/shared/src/types/analysis';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis, type SplitAnalysisResult } from '../../packages/analyzer/src/split-analyzer';

const FIXTURE_PATH = new URL('../fixtures/sample-project', import.meta.url).pathname;

describe('performSplitAnalysis — layer details (Phase 2)', () => {
  let result: SplitAnalysisResult;

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const fileAnalyses: FileAnalysis[] = [];
    for (const file of files) {
      const analysis = await analyzeFile(file);
      if (analysis) fileAnalyses.push(analysis);
    }
    const deps = buildDependencyGraph(fileAnalyses, FIXTURE_PATH);
    result = performSplitAnalysis(FIXTURE_PATH, fileAnalyses, deps);
  });

  it('returns layerDetails array', () => {
    expect(Array.isArray(result.layerDetails)).toBe(true);
    expect(result.layerDetails.length).toBeGreaterThan(0);
  });

  it('each layerDetail has required fields', () => {
    for (const detail of result.layerDetails) {
      expect(detail).toHaveProperty('serviceName');
      expect(detail).toHaveProperty('layer');
      expect(detail).toHaveProperty('fileCount');
      expect(detail).toHaveProperty('filePaths');
      expect(detail).toHaveProperty('confidence');
      expect(detail).toHaveProperty('evidence');
      expect(['api', 'service', 'data', 'external']).toContain(detail.layer);
      expect(detail.fileCount).toBeGreaterThan(0);
      expect(detail.filePaths.length).toBe(detail.fileCount);
    }
  });

  it('has layer details for each detected service', () => {
    const serviceNames = new Set(result.layerDetails.map((d) => d.serviceName));
    for (const service of result.services) {
      expect(serviceNames.has(service.name)).toBe(true);
    }
  });

  it('layer filePaths are subsets of the corresponding service files', () => {
    for (const detail of result.layerDetails) {
      const service = result.services.find((s) => s.name === detail.serviceName);
      expect(service).toBeDefined();
      for (const filePath of detail.filePaths) {
        expect(service!.files).toContain(filePath);
      }
    }
  });

  it('api-gateway has an api layer', () => {
    const apiLayers = result.layerDetails.filter(
      (d) => d.serviceName === 'api-gateway' && d.layer === 'api'
    );
    expect(apiLayers.length).toBe(1);
    expect(apiLayers[0].fileCount).toBeGreaterThan(0);
  });

  it('user-service has a data layer', () => {
    const dataLayers = result.layerDetails.filter(
      (d) => d.serviceName === 'user-service' && d.layer === 'data'
    );
    expect(dataLayers.length).toBe(1);
    expect(dataLayers[0].fileCount).toBeGreaterThan(0);
  });

  it('returns layerDependencies array', () => {
    expect(Array.isArray(result.layerDependencies)).toBe(true);
  });

  it('each layerDependency has required fields', () => {
    for (const dep of result.layerDependencies) {
      expect(dep).toHaveProperty('sourceServiceName');
      expect(dep).toHaveProperty('sourceLayer');
      expect(dep).toHaveProperty('targetServiceName');
      expect(dep).toHaveProperty('targetLayer');
      expect(dep).toHaveProperty('dependencyCount');
      expect(dep).toHaveProperty('isViolation');
      expect(typeof dep.isViolation).toBe('boolean');
      expect(dep.dependencyCount).toBeGreaterThan(0);
    }
  });

  it('violations have a violationReason', () => {
    const violations = result.layerDependencies.filter((d) => d.isViolation);
    for (const v of violations) {
      expect(v.violationReason).toBeDefined();
      expect(v.violationReason!.length).toBeGreaterThan(0);
    }
  });

  it('non-violations do not have a violationReason', () => {
    const nonViolations = result.layerDependencies.filter((d) => !d.isViolation);
    for (const d of nonViolations) {
      expect(d.violationReason).toBeUndefined();
    }
  });
});
