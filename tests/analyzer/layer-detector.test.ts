import { describe, it, expect } from 'vitest';
import type { FileAnalysis } from '../../packages/shared/src/types/analysis';
import { detectLayers, toLayerDetectionResults } from '../../packages/analyzer/src/layer-detector';

function makeAnalysis(imports: Array<{ source: string }>): FileAnalysis {
  return {
    filePath: '/test/file.ts',
    language: 'typescript',
    functions: [],
    classes: [],
    imports: imports.map((i) => ({
      source: i.source,
      specifiers: [{ name: 'default', alias: undefined, isDefault: true, isNamespace: false }],
      isTypeOnly: false,
    })),
    exports: [],
    calls: [],
    httpCalls: [],
  };
}

describe('detectLayers', () => {
  it("detects data layer for '@prisma/client' import", () => {
    const analysis = makeAnalysis([{ source: '@prisma/client' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('data');
  });

  it("detects data layer for 'typeorm' import", () => {
    const analysis = makeAnalysis([{ source: 'typeorm' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('data');
  });

  it("detects data layer for 'drizzle-orm' import", () => {
    const analysis = makeAnalysis([{ source: 'drizzle-orm' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('data');
  });

  it("detects api layer for 'express' import", () => {
    const analysis = makeAnalysis([{ source: 'express' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('api');
  });

  it("detects external layer for 'axios' import", () => {
    const analysis = makeAnalysis([{ source: 'axios' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('external');
  });

  it("detects external layer for '@aws-sdk/client-s3' import", () => {
    const analysis = makeAnalysis([{ source: '@aws-sdk/client-s3' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('external');
  });

  it('defaults to service layer when no matching imports', () => {
    const analysis = makeAnalysis([{ source: './local-util' }]);
    const result = detectLayers(analysis);
    expect(result.layers).toContain('service');
  });

  it('returns confidence > 0.8 for specific layer matches', () => {
    const analysis = makeAnalysis([{ source: 'express' }]);
    const result = detectLayers(analysis);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('returns confidence 0.5 for default service layer', () => {
    const analysis = makeAnalysis([{ source: './something' }]);
    const result = detectLayers(analysis);
    expect(result.confidence).toBe(0.5);
  });
});

describe('toLayerDetectionResults', () => {
  it('converts internal format to LayerDetectionResult array', () => {
    const analysis = makeAnalysis([{ source: 'express' }]);
    const detection = detectLayers(analysis);
    const results = toLayerDetectionResults(detection);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);

    const first = results[0]!;
    expect(first).toHaveProperty('layer');
    expect(first).toHaveProperty('confidence');
    expect(first).toHaveProperty('evidence');
    expect(Array.isArray(first.evidence)).toBe(true);
  });

  it('produces one result per detected layer', () => {
    // Express (api) + axios (external) should produce two layers
    const analysis = makeAnalysis([{ source: 'express' }, { source: 'axios' }]);
    const detection = detectLayers(analysis);
    const results = toLayerDetectionResults(detection);

    expect(results.length).toBe(detection.layers.length);
    const layerNames = results.map((r) => r.layer);
    expect(layerNames).toContain('api');
    expect(layerNames).toContain('external');
  });
});
