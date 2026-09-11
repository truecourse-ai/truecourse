/**
 * The ONE ref grammar of the workspace corpus: `context/<sourceId>/<docPath>`.
 * Nothing else composes or splits it, so this is where the grammar is pinned —
 * what it builds, what it reads back, and everything it refuses.
 */

import { describe, it, expect } from 'vitest';
import {
  CONTEXT_REF_PREFIX,
  contextDocRef,
  isContextDocRef,
  isValidContextDocPath,
  isValidContextSourceId,
  parseContextDocRef,
} from '@truecourse/core/lib/context-ref';

describe('context ref grammar', () => {
  it('builds a ref from a source id and a document path', () => {
    expect(contextDocRef('repo-acme-api', 'docs/guide.md')).toBe('context/repo-acme-api/docs/guide.md');
    expect(CONTEXT_REF_PREFIX).toBe('context');
  });

  it('normalizes windows separators into the one grammar', () => {
    expect(contextDocRef('site-docs-acme-com', 'cms\\install.md')).toBe(
      'context/site-docs-acme-com/cms/install.md',
    );
  });

  it('reads a ref back into its two halves, deepest path included', () => {
    expect(parseContextDocRef('context/repo-acme-api/docs/a/b/c.md')).toEqual({
      sourceId: 'repo-acme-api',
      docPath: 'docs/a/b/c.md',
    });
  });

  it('round-trips every ref it builds', () => {
    for (const [sourceId, docPath] of [
      ['repo-acme-api', 'README.md'],
      ['site-docs', 'cms/api/rest.md'],
      ['s1', 'openapi.yaml'],
    ] as const) {
      expect(parseContextDocRef(contextDocRef(sourceId, docPath))).toEqual({ sourceId, docPath });
    }
  });

  it('is not a context ref when the prefix is missing', () => {
    expect(parseContextDocRef('docs/guide.md')).toBeNull();
    expect(parseContextDocRef('knowledge/confluence/42.md')).toBeNull();
    expect(parseContextDocRef('.truecourse/specs/sources/site/x.md')).toBeNull();
    expect(isContextDocRef('contextual/x/y.md')).toBe(false);
  });

  it('refuses a ref with no document path', () => {
    expect(parseContextDocRef('context/repo-acme-api')).toBeNull();
    expect(parseContextDocRef('context/repo-acme-api/')).toBeNull();
    expect(parseContextDocRef('context//guide.md')).toBeNull();
  });

  it('refuses a path that escapes its source directory', () => {
    expect(parseContextDocRef('context/site/../../etc/passwd')).toBeNull();
    expect(parseContextDocRef('context/site/./guide.md')).toBeNull();
    expect(parseContextDocRef('context/site//guide.md')).toBeNull();
    expect(() => contextDocRef('site', '../escape.md')).toThrow(/Invalid context document path/);
    expect(() => contextDocRef('site', '/abs.md')).toThrow(/Invalid context document path/);
    expect(() => contextDocRef('site', '')).toThrow(/Invalid context document path/);
  });

  it('refuses a source id that is not one clean path segment', () => {
    expect(isValidContextSourceId('repo-acme-api')).toBe(true);
    expect(isValidContextSourceId('a/b')).toBe(false);
    expect(isValidContextSourceId('..')).toBe(false);
    expect(isValidContextSourceId('')).toBe(false);
    expect(isValidContextSourceId('-leading')).toBe(false);
    expect(() => contextDocRef('a/b', 'x.md')).toThrow(/Invalid context source id/);
  });

  it('accepts a plain relative path and refuses a drive-rooted one', () => {
    expect(isValidContextDocPath('docs/guide.md')).toBe(true);
    expect(isValidContextDocPath('C:/docs/guide.md')).toBe(false);
  });
});
