import { describe, it, expect } from 'vitest';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ForbiddenArtifactContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): ForbiddenArtifactContract {
  const r = resolve([parseFile('fa.tc', src)]);
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.index.values().next().value!.contract as ForbiddenArtifactContract;
}

describe('ForbiddenArtifact lifter', () => {
  it('lifts a file-glob forbidden-artifact', () => {
    const c = lift(`forbidden-artifact st-downloader {
      category file-glob
      pattern "pipeline/**/st_downloader.py"
      reason "ServiceTitan downloader is out of scope for V1"
    }`);
    expect(c).toEqual({
      category: 'file-glob',
      pattern: 'pipeline/**/st_downloader.py',
      reason: 'ServiceTitan downloader is out of scope for V1',
    });
  });

  it('lifts each category: env-var, dependency, feature-flag', () => {
    expect(lift(`forbidden-artifact x {
      category env-var
      pattern "AUTH_BYPASS"
      reason "no bypass"
    }`)).toMatchObject({
      category: 'env-var',
      pattern: 'AUTH_BYPASS',
    });
    expect(lift(`forbidden-artifact x {
      category dependency
      pattern "openai"
      reason "use anthropic"
    }`)).toMatchObject({
      category: 'dependency',
      pattern: 'openai',
    });
    expect(lift(`forbidden-artifact x {
      category feature-flag
      pattern "FEATURE_FOO"
      reason "off"
    }`)).toMatchObject({
      category: 'feature-flag',
      pattern: 'FEATURE_FOO',
    });
  });

  it('defaults category to file-glob when invalid value given', () => {
    const c = lift(`forbidden-artifact x {
      category bogus
      pattern "p"
      reason "r"
    }`);
    expect(c.category).toBe('file-glob');
  });
});
