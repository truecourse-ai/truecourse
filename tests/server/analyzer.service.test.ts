import { describe, it, expect, beforeAll } from 'vitest';
import { runAnalysis, type AnalysisResult } from '../../apps/server/src/services/analyzer.service';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-js-project-negative');

describe('runAnalysis (integration)', () => {
  let result: AnalysisResult;
  const progressCalls: { step: string; percent: number; detail?: string }[] = [];

  beforeAll(async () => {
    result = await runAnalysis(FIXTURE_PATH, undefined, (progress) => {
      progressCalls.push(progress);
    }, { skipStash: true, skipGit: true });
  }, 60_000);

  it('calls progress callback multiple times', () => {
    expect(progressCalls.length).toBeGreaterThan(1);
  });

  it('progress callback receives step names and percent values', () => {
    for (const call of progressCalls) {
      expect(typeof call.step).toBe('string');
      expect(call.step.length).toBeGreaterThan(0);
      expect(typeof call.percent).toBe('number');
      expect(call.percent).toBeGreaterThanOrEqual(0);
      expect(call.percent).toBeLessThanOrEqual(100);
    }
  });

  it('result has architecture field', () => {
    expect(result.architecture).toBeDefined();
    expect(['monolith', 'microservices']).toContain(result.architecture);
  });

  it('result has services array with expected entries', () => {
    expect(Array.isArray(result.services)).toBe(true);
    expect(result.services.length).toBeGreaterThanOrEqual(3);
    const names = result.services.map((s) => s.name);
    expect(names).toContain('api-gateway');
    expect(names).toContain('user-service');
  });

  it('result has dependencies array', () => {
    expect(Array.isArray(result.dependencies)).toBe(true);
  });

  it('result has fileAnalyses array (non-empty)', () => {
    expect(Array.isArray(result.fileAnalyses)).toBe(true);
    expect(result.fileAnalyses.length).toBeGreaterThan(0);
  });

  it('result has moduleDependencies array', () => {
    expect(Array.isArray(result.moduleDependencies)).toBe(true);
  });

  it('each service has correct type', () => {
    const validTypes = ['frontend', 'api-server', 'worker', 'library', 'unknown'];
    for (const service of result.services) {
      expect(validTypes).toContain(service.type);
    }
  });
});
