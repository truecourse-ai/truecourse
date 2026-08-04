import { describe, it, expect } from 'vitest';
import {
  isSpecDoc,
  detectSpecDocChanges,
  specScopeFromConfigJson,
  isCodeFile,
  hasCodeChanges,
} from '../../ee/packages/github-app/src/index';
import { buildSpecScope } from '../../packages/shared/src/index.js';

describe('isSpecDoc', () => {
  it('accepts markdown outside build/output dirs', () => {
    expect(isSpecDoc('docs/spec.md')).toBe(true);
    expect(isSpecDoc('README.md')).toBe(true);
    expect(isSpecDoc('reference/auth.markdown')).toBe(true);
    expect(isSpecDoc('a/b/c/NOTES.MD')).toBe(true);
  });

  // This gate must recognise exactly what the scanner's `discoverDocs`
  // discovers — the extension set is shared for that reason. A doc the gate
  // misses is a doc whose edits never prompt a re-scan, which fails silently.
  it('accepts every markdown flavour the scanner discovers', () => {
    expect(isSpecDoc('docs/guide.mdx')).toBe(true);
    expect(isSpecDoc('docs/guide.mdown')).toBe(true);
    expect(isSpecDoc('docs/guide.mkd')).toBe(true);
  });

  it('rejects non-markdown', () => {
    expect(isSpecDoc('src/index.ts')).toBe(false);
    expect(isSpecDoc('package.json')).toBe(false);
    expect(isSpecDoc('docs/notes.txt')).toBe(false);
  });

  it('rejects markdown inside skipped dirs', () => {
    expect(isSpecDoc('node_modules/pkg/readme.md')).toBe(false);
    expect(isSpecDoc('dist/spec.md')).toBe(false);
    expect(isSpecDoc('.truecourse/specs/notes.md')).toBe(false);
    expect(isSpecDoc('coverage/report.md')).toBe(false);
  });
});

describe('detectSpecDocChanges', () => {
  it('returns only the spec docs among changed files', () => {
    expect(
      detectSpecDocChanges([
        'src/app.ts',
        'docs/spec.md',
        'node_modules/x/readme.md',
        'reference/orders.md',
        'package.json',
      ]),
    ).toEqual(['docs/spec.md', 'reference/orders.md']);
  });

  it('returns empty when no spec docs changed', () => {
    expect(detectSpecDocChanges(['src/a.ts', 'src/b.ts'])).toEqual([]);
  });
});

describe('detectSpecDocChanges — include-scope', () => {
  it('narrows detection to the repo scope, mirroring discovery', () => {
    const scope = buildSpecScope(['docs/**']);
    expect(
      detectSpecDocChanges(
        ['docs/spec.md', 'reference/orders.md', 'README.md', 'src/app.ts'],
        scope,
      ),
    ).toEqual(['docs/spec.md']);
  });

  it('an inactive scope is the same as no scope (everything)', () => {
    const scope = buildSpecScope([]);
    expect(detectSpecDocChanges(['docs/spec.md', 'README.md'], scope)).toEqual([
      'docs/spec.md',
      'README.md',
    ]);
  });

  it('isSpecDoc still rejects skip-dir markdown even inside the scope', () => {
    const scope = buildSpecScope(['**']);
    expect(isSpecDoc('node_modules/pkg/readme.md', scope)).toBe(false);
    expect(isSpecDoc('docs/spec.md', scope)).toBe(true);
  });
});

describe('specScopeFromConfigJson', () => {
  it('builds an active scope from a config with spec.include', () => {
    const scope = specScopeFromConfigJson(JSON.stringify({ spec: { include: ['docs/**'] } }));
    expect(scope.active).toBe(true);
    expect(detectSpecDocChanges(['docs/a.md', 'other/b.md'], scope)).toEqual(['docs/a.md']);
  });

  it('degrades a null config to scan-everything (fetch failure)', () => {
    const scope = specScopeFromConfigJson(null);
    expect(scope.active).toBe(false);
    expect(detectSpecDocChanges(['docs/a.md', 'other/b.md'], scope)).toEqual([
      'docs/a.md',
      'other/b.md',
    ]);
  });

  it('degrades a malformed config to scan-everything, never throws', () => {
    expect(() => specScopeFromConfigJson('{ not json')).not.toThrow();
    expect(specScopeFromConfigJson('{ not json').active).toBe(false);
    // Empty include array = absent = inactive.
    expect(specScopeFromConfigJson(JSON.stringify({ spec: { include: [] } })).active).toBe(false);
  });
});

describe('isCodeFile / hasCodeChanges', () => {
  it('accepts analyzable source outside build dirs', () => {
    expect(isCodeFile('src/app.ts')).toBe(true);
    expect(isCodeFile('api/handler.py')).toBe(true);
    expect(isCodeFile('web/Button.tsx')).toBe(true);
    expect(isCodeFile('scripts/x.mjs')).toBe(true);
  });

  it('rejects docs, config, and skipped dirs', () => {
    expect(isCodeFile('docs/spec.md')).toBe(false);
    expect(isCodeFile('package.json')).toBe(false);
    expect(isCodeFile('main.go')).toBe(false);
    expect(isCodeFile('node_modules/x/index.js')).toBe(false);
    expect(isCodeFile('dist/app.js')).toBe(false);
  });

  it('hasCodeChanges is true only when some code changed', () => {
    expect(hasCodeChanges(['docs/spec.md', 'src/app.ts'])).toBe(true);
    expect(hasCodeChanges(['docs/spec.md', 'README.md'])).toBe(false);
    expect(hasCodeChanges([])).toBe(false);
  });
});
