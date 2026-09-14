import { describe, it, expect, afterEach } from 'vitest';
import {
  readRepoDoc,
  resetRepoDocReader,
  setRepoDocReader,
} from '../../packages/core/src/lib/repo-doc-reader';

/**
 * The document-reading seam. There is no default: a document is never read from
 * a tree, so a process that never installed a reader must say so rather than
 * inventing a path and reading whatever is beside it.
 */
describe('repo-doc-reader seam', () => {
  afterEach(() => {
    resetRepoDocReader();
  });

  it('refuses to read before a reader is installed', () => {
    expect(() => readRepoDoc('owner/repo', 'README.md')).toThrow(/No repo doc reader installed/);
  });

  it('delegates to the installed reader, which is handed the ref verbatim', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    setRepoDocReader(async (repoKey, docPath, opts) => {
      calls.push([repoKey, docPath, opts?.commit]);
      return `stored:${repoKey}:${docPath}`;
    });

    // `repoKey` is an opaque repository identity, never a filesystem path.
    expect(await readRepoDoc('owner/repo', 'README.md')).toBe('stored:owner/repo:README.md');
    expect(await readRepoDoc('owner/repo', 'context/site/refunds.md', { commit: 'abc123' }))
      .toBe('stored:owner/repo:context/site/refunds.md');
    expect(calls).toEqual([
      ['owner/repo', 'README.md', undefined],
      ['owner/repo', 'context/site/refunds.md', 'abc123'],
    ]);
  });

  it('surfaces the installed reader answering absent (→ route 404)', async () => {
    setRepoDocReader(async () => null);
    expect(await readRepoDoc('owner/repo', 'README.md')).toBeNull();
  });
});
