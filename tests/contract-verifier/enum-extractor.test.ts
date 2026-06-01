import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractEnumsFromFile } from '../../packages/contract-verifier/src/extractor/enum/ts-enums.js';

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/x.ts') {
  const tree = parseFile(filePath, source, 'typescript');
  return extractEnumsFromFile(filePath, source, tree);
}

describe('Enum extractor (JS/TS shapes)', () => {
  describe('ts-union', () => {
    it('extracts type X = "a" | "b" | "c"', () => {
      const e = extract(`type Status = 'active' | 'inactive' | 'pending';`);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({
        name: 'Status',
        values: ['active', 'inactive', 'pending'],
        shape: 'ts-union',
      });
    });

    it('ignores type X = string (non-union)', () => {
      const e = extract(`type Name = string;`);
      expect(e).toEqual([]);
    });

    it('ignores type X = "a" (single literal, not enum)', () => {
      const e = extract(`type Const = 'only';`);
      expect(e).toEqual([]);
    });

    it('flattens nested type unions', () => {
      const e = extract(`type X = 'a' | ('b' | 'c');`);
      expect(e[0].values).toEqual(['a', 'b', 'c']);
    });
  });

  describe('ts-enum', () => {
    it('extracts enum X { A = "a", B = "b" }', () => {
      const e = extract(`enum Status { Active = 'active', Inactive = 'inactive' }`);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({
        name: 'Status',
        values: ['active', 'inactive'],
        shape: 'ts-enum',
      });
    });

    it('skips numeric enum members (v1 string-only)', () => {
      const e = extract(`enum N { A = 1, B = 2 }`);
      expect(e).toEqual([]);
    });
  });

  describe('zod-enum', () => {
    it('extracts z.enum([...]) assigned to a const', () => {
      const e = extract(`const StatusEnum = z.enum(['active', 'archived']);`);
      expect(e.find((x) => x.shape === 'zod-enum')).toMatchObject({
        name: 'StatusEnum',
        values: ['active', 'archived'],
      });
    });

    it('extracts z.enum([...]) used inline in a schema property', () => {
      const e = extract(`
        const Schema = z.object({
          status: z.enum(['PASS', 'MISSING', 'INVALID']),
        });
      `);
      const zEnum = e.find((x) => x.shape === 'zod-enum');
      expect(zEnum).toBeDefined();
      expect(zEnum!.values).toEqual(['INVALID', 'MISSING', 'PASS']);
      // The inline name should come from the property key.
      expect(zEnum!.name).toBe('status');
    });
  });

  describe('zod-union of literals', () => {
    it('extracts z.union([z.literal(...)])', () => {
      const e = extract(`
        const StatusU = z.union([z.literal('a'), z.literal('b'), z.literal('c')]);
      `);
      expect(e.find((x) => x.shape === 'zod-union')).toMatchObject({
        name: 'StatusU',
        values: ['a', 'b', 'c'],
      });
    });

    it('ignores z.union mixing literals + other schemas', () => {
      const e = extract(`
        const Mixed = z.union([z.literal('a'), z.number()]);
      `);
      expect(e.find((x) => x.shape === 'zod-union')).toBeUndefined();
    });
  });

  describe('as-const object', () => {
    it('extracts const X = { A: "a", B: "b" } as const', () => {
      const e = extract(`const Status = { Active: 'active', Inactive: 'inactive' } as const;`);
      expect(e.find((x) => x.shape === 'as-const-object')).toMatchObject({
        name: 'Status',
        values: ['active', 'inactive'],
      });
    });

    it('ignores plain objects without as const', () => {
      const e = extract(`const Status = { Active: 'active', Inactive: 'inactive' };`);
      expect(e.find((x) => x.shape === 'as-const-object')).toBeUndefined();
    });
  });

  describe('set/array literals', () => {
    it('extracts const VALID_X = new Set([...])', () => {
      const e = extract(`const VALID_STATUS = new Set(['a', 'b', 'c']);`);
      expect(e.find((x) => x.shape === 'set-literal')).toMatchObject({
        name: 'VALID_STATUS',
        values: ['a', 'b', 'c'],
      });
    });

    it('extracts const NON_PASS = new Set([...]) — convention prefix', () => {
      const e = extract(`const NON_PASS = new Set(['MISSING', 'INVALID', 'SUSPECT']);`);
      // Bare-name without VALID_/ALLOWED_/_VALUES/_SET suffix → not
      // recognized in v1 to avoid false positives. Confirms the
      // restriction (we intentionally skip set-shaped consts without a
      // conventional name).
      expect(e.find((x) => x.shape === 'set-literal')).toBeUndefined();
    });

    it('extracts STATUS_SET / STATUS_VALUES naming', () => {
      const e = extract(`
        const STATUS_SET = new Set(['a', 'b']);
        const STATUS_VALUES = ['c', 'd'];
      `);
      expect(e.find((x) => x.name === 'STATUS_SET')).toMatchObject({ values: ['a', 'b'] });
      expect(e.find((x) => x.name === 'STATUS_VALUES')).toMatchObject({ values: ['c', 'd'] });
    });

    it('ignores anonymous array literals (no convention name)', () => {
      const e = extract(`const xs = ['a', 'b'];`);
      expect(e).toEqual([]);
    });
  });

  it('sorts values alphabetically + dedupes', () => {
    const e = extract(`type X = 'c' | 'a' | 'b' | 'a';`);
    expect(e[0].values).toEqual(['a', 'b', 'c']);
  });

  it('returns source location of the declaration', () => {
    const src = `// line 1
// line 2
type Status = 'a' | 'b';
`;
    const e = extract(src);
    expect(e[0].source.lineStart).toBe(3);
  });
});
