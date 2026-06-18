import { describe, it, expect } from 'vitest';
import {
  isSpecDoc,
  detectSpecDocChanges,
  isCodeFile,
  hasCodeChanges,
} from '../../ee/packages/github-app/src/index';

describe('isSpecDoc', () => {
  it('accepts markdown outside build/output dirs', () => {
    expect(isSpecDoc('docs/spec.md')).toBe(true);
    expect(isSpecDoc('README.md')).toBe(true);
    expect(isSpecDoc('reference/auth.markdown')).toBe(true);
    expect(isSpecDoc('a/b/c/NOTES.MD')).toBe(true);
  });

  it('rejects non-markdown', () => {
    expect(isSpecDoc('src/index.ts')).toBe(false);
    expect(isSpecDoc('package.json')).toBe(false);
    expect(isSpecDoc('docs/diagram.mdx')).toBe(false);
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
