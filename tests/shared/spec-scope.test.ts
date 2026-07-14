import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSpecScope, loadSpecScope } from '../../packages/shared/src/index.js';

/**
 * `spec.include` — the opt-in inverse of `.truecourseignore`, scoping spec-doc
 * discovery to markdown that matches a glob. Load-bearing properties: an
 * absent/empty scope is inactive (everything in scope, unchanged behavior),
 * gitignore-style globs, and a robust read that degrades a malformed config to
 * inactive rather than throwing.
 */

describe('buildSpecScope', () => {
  it('is inactive for an absent, empty, or all-blank list', () => {
    for (const globs of [undefined, null, [], ['', '   '], 'not-an-array', 42]) {
      const scope = buildSpecScope(globs as unknown);
      expect(scope.active).toBe(false);
      expect(scope.globs).toEqual([]);
      // Inactive → everything matches.
      expect(scope.includes('anything/at/all.md')).toBe(true);
    }
  });

  it('matches gitignore-style globs when active', () => {
    const scope = buildSpecScope(['docs/**', 'specs/*.md']);
    expect(scope.active).toBe(true);
    expect(scope.globs).toEqual(['docs/**', 'specs/*.md']);
    expect(scope.includes('docs/spec.md')).toBe(true);
    expect(scope.includes('docs/nested/deep/api.md')).toBe(true);
    expect(scope.includes('specs/orders.md')).toBe(true);
    // `specs/*.md` does not cross a slash.
    expect(scope.includes('specs/sub/orders.md')).toBe(false);
    // Outside every glob.
    expect(scope.includes('README.md')).toBe(false);
    expect(scope.includes('src/app.ts')).toBe(false);
  });

  it('drops non-string / blank entries but stays active on the rest', () => {
    const scope = buildSpecScope(['docs/**', '', 123, null, '  specs/**  ']);
    expect(scope.active).toBe(true);
    expect(scope.globs).toEqual(['docs/**', 'specs/**']);
    expect(scope.includes('specs/x.md')).toBe(true);
  });

  it('never includes an empty or root-escaping path', () => {
    const scope = buildSpecScope(['**']);
    expect(scope.includes('')).toBe(false);
    expect(scope.includes('../sibling.md')).toBe(false);
  });
});

describe('loadSpecScope', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scope-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(config: unknown): void {
    fs.mkdirSync(path.join(root, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(root, '.truecourse', 'config.json'), JSON.stringify(config));
  }

  it('is inactive when there is no config.json', () => {
    expect(loadSpecScope(root).active).toBe(false);
  });

  it('reads spec.include from config.json', () => {
    writeConfig({ spec: { include: ['docs/**'] } });
    const scope = loadSpecScope(root);
    expect(scope.active).toBe(true);
    expect(scope.includes('docs/a.md')).toBe(true);
    expect(scope.includes('other/a.md')).toBe(false);
  });

  it('is inactive for an empty include array (same as absent)', () => {
    writeConfig({ spec: { include: [] } });
    expect(loadSpecScope(root).active).toBe(false);
  });

  it('is inactive when spec.include is absent even if other config exists', () => {
    writeConfig({ enableLlmRules: false, spec: {} });
    expect(loadSpecScope(root).active).toBe(false);
  });

  it('degrades a malformed config.json to inactive', () => {
    fs.mkdirSync(path.join(root, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(root, '.truecourse', 'config.json'), '{ not json');
    expect(loadSpecScope(root).active).toBe(false);
  });
});
