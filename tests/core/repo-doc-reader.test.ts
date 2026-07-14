import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  readRepoDoc,
  setRepoDocReader,
  type RepoDocReader,
} from '../../packages/core/src/lib/repo-doc-reader';

// The seam ships an FS default; restore it after any test that swaps the reader.
const fsDefault: RepoDocReader = async (repoKey, docPath) => {
  const root = path.resolve(repoKey);
  const full = path.resolve(root, docPath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full, 'utf-8');
};

describe('repo-doc-reader seam', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repo-doc-'));
    fs.writeFileSync(path.join(repo, 'README.md'), '# Hello\n', 'utf-8');
    fs.mkdirSync(path.join(repo, 'docs', 'adr'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'adr', 'ADR-001.md'), 'decision', 'utf-8');
  });

  afterEach(() => {
    setRepoDocReader(fsDefault);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('OSS default (filesystem)', () => {
    it('reads a repo-relative doc from the working tree', async () => {
      expect(await readRepoDoc(repo, 'README.md')).toBe('# Hello\n');
      expect(await readRepoDoc(repo, 'docs/adr/ADR-001.md')).toBe('decision');
    });

    it('returns null for a missing doc', async () => {
      expect(await readRepoDoc(repo, 'NOPE.md')).toBeNull();
    });

    it('returns null for a directory (not a file)', async () => {
      expect(await readRepoDoc(repo, 'docs')).toBeNull();
    });

    it('refuses to escape the repo tree', async () => {
      expect(await readRepoDoc(repo, '../secret.md')).toBeNull();
    });
  });

  describe('EE override', () => {
    it('delegates to the installed reader (e.g. a GitHub-backed one)', async () => {
      const calls: Array<[string, string]> = [];
      setRepoDocReader(async (repoKey, docPath) => {
        calls.push([repoKey, docPath]);
        return `remote:${repoKey}:${docPath}`;
      });
      // repoKey is an opaque key in EE, never a real path.
      expect(await readRepoDoc('owner/repo', 'README.md')).toBe('remote:owner/repo:README.md');
      expect(calls).toEqual([['owner/repo', 'README.md']]);
    });

    it('surfaces the installed reader returning null (→ route 404)', async () => {
      setRepoDocReader(async () => null);
      expect(await readRepoDoc('owner/repo', 'README.md')).toBeNull();
    });
  });
});
