import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureRepoTruecourseDir } from '../../packages/core/src/config/paths';

// The scaffolded `.truecourse/.gitignore` must match the documented
// committable-vs-local layout (README "Setup"). Getting this wrong both lets
// users commit generated artifacts and — combined with the stash — used to
// delete the contracts `verify` reads (issue #542).

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-paths-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('ensureRepoTruecourseDir .gitignore template', () => {
  it('ignores generated/local state but keeps the spec and baselines committable', () => {
    ensureRepoTruecourseDir(repo);
    const lines = fs
      .readFileSync(path.join(repo, '.truecourse', '.gitignore'), 'utf-8')
      .split('\n')
      .filter(Boolean);

    // Local-only state (ignored).
    for (const ignored of [
      'analyses/',
      'logs/',
      '.analyze.lock',
      'contracts/',
      'verifier/runs/',
      'verifier/history.json',
      'verifier/diff.json',
      '.cache/',
    ]) {
      expect(lines).toContain(ignored);
    }

    // Committable — must NOT be ignored (travels with the repo).
    for (const committable of ['specs/', 'verifier/LATEST.json', 'LATEST.json', 'config.json']) {
      expect(lines).not.toContain(committable);
    }
  });
});
