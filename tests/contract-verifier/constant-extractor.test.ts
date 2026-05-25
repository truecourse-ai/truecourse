import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractConstantsFromFile } from '../../packages/contract-verifier/src/extractor/constant/ts-constants.js';

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/x.ts') {
  const tree = parseFile(filePath, source, 'typescript');
  return extractConstantsFromFile(filePath, source, tree);
}

describe('Constant extractor', () => {
  describe('const-literal', () => {
    it('extracts const X = "string"', () => {
      const c = extract(`const LLM_MODEL = "claude-sonnet-4-6";`);
      expect(c).toEqual([{
        name: 'LLM_MODEL',
        value: 'claude-sonnet-4-6',
        shape: 'const-literal',
        source: expect.objectContaining({ filePath: '/test/x.ts' }),
      }]);
    });

    it('extracts const X = 42', () => {
      const c = extract(`const MAX_RETRY = 42;`);
      expect(c[0].value).toBe(42);
    });

    it('extracts const X = -0.5', () => {
      const c = extract(`const NEG = -0.5;`);
      expect(c[0].value).toBe(-0.5);
    });

    it('extracts const X = true', () => {
      const c = extract(`const DEBUG = true;`);
      expect(c[0].value).toBe(true);
    });

    it('extracts const X = [a, b]', () => {
      const c = extract(`const VALID = ["active", "pending"];`);
      expect(c[0].value).toEqual(['active', 'pending']);
    });

    it('extracts const X = { ... } both as outer + per-key', () => {
      const c = extract(`const TIER_WEIGHTS = { Critical: 3, Significant: 2, Minor: 1 };`);
      // One outer + 3 property entries
      expect(c.find((e) => e.shape === 'const-literal' && e.name === 'TIER_WEIGHTS')?.value).toEqual({
        Critical: 3, Significant: 2, Minor: 1,
      });
      expect(c.find((e) => e.shape === 'object-property' && e.name === 'Critical')?.value).toBe(3);
      expect(c.find((e) => e.shape === 'object-property' && e.name === 'Significant')?.value).toBe(2);
      expect(c.find((e) => e.shape === 'object-property' && e.name === 'Minor')?.value).toBe(1);
    });

    it('extracts nested object literals', () => {
      const c = extract(`const cfg = { db: { host: "x", port: 5432 } };`);
      const outer = c.find((e) => e.name === 'cfg');
      expect(outer?.value).toEqual({ db: { host: 'x', port: 5432 } });
    });

    it('skips constants whose initializer is a function call', () => {
      const c = extract(`const x = computeX();`);
      expect(c).toEqual([]);
    });

    it('skips constants whose initializer is an identifier reference', () => {
      const c = extract(`const x = SOME_OTHER_CONST;`);
      expect(c).toEqual([]);
    });

    it('handles as const wrapper', () => {
      const c = extract(`const STATUS = "active" as const;`);
      const lit = c.find((e) => e.shape === 'const-literal');
      expect(lit?.value).toBe('active');
    });

    it('skips template strings with interpolation', () => {
      const c = extract(`const url = \`https://\${HOST}/api\`;`);
      expect(c).toEqual([]);
    });

    it('extracts plain template strings without interpolation', () => {
      const c = extract(`const VERSION = \`v1.0\`;`);
      expect(c[0]?.value).toBe('v1.0');
    });
  });

  describe('default-arg', () => {
    it('extracts default arg in arrow function', () => {
      const c = extract(`const f = (model = "claude-sonnet-4-6") => model;`);
      const arg = c.find((e) => e.shape === 'default-arg');
      expect(arg).toBeDefined();
      expect(arg!.name).toBe('model');
      expect(arg!.value).toBe('claude-sonnet-4-6');
    });

    it('extracts default arg in regular function', () => {
      const c = extract(`function call(model = "x", retries = 3) {}`);
      const args = c.filter((e) => e.shape === 'default-arg');
      expect(args.length).toBeGreaterThanOrEqual(2);
      const model = args.find((a) => a.name === 'model');
      const retries = args.find((a) => a.name === 'retries');
      expect(model?.value).toBe('x');
      expect(retries?.value).toBe(3);
    });
  });

  it('produces multiple constants per file', () => {
    const c = extract(`
      const A = "x";
      const B = 42;
      const C = true;
    `);
    const names = c.filter((e) => e.shape === 'const-literal').map((e) => e.name).sort();
    expect(names).toEqual(['A', 'B', 'C']);
  });
});
