/**
 * The pre-flight scan estimate must never pay for git.
 *
 * A doc's `lastTouched` costs one `git log` PROCESS per doc — ~7.6s for 492 docs,
 * and it was ~99% of the estimate's wall time — while nothing the estimate
 * computes reads it (cache keys are path + contentHash, identity is derived from
 * doc bodies). So the estimate discovers with `skipGit` and the curate run still
 * derives it for the corpus. Both halves are pinned here: no process is spawned,
 * and the numbers don't move when the history it would have read is gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Records every child process the estimate spawns, then delegates to the real
// implementation so discovery behaves exactly as it does in production.
const { spawned } = vi.hoisted(() => ({ spawned: [] as string[] }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: (file: string, args: string[], opts: unknown) => {
      spawned.push([file, ...args].join(' '));
      return (actual.execFileSync as (...a: unknown[]) => unknown)(file, args, opts);
    },
  };
});

const { estimateScanTokens } = await import('../../packages/core/src/services/llm/spec-estimate.js');
const { discoverDocs } = await import('../../packages/spec-consolidator/src/index.js');

const DOCS = ['users', 'auth', 'billing'];

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-estimate-git-'));
  const docs = path.join(repo, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  for (const name of DOCS) {
    fs.writeFileSync(path.join(docs, `${name}.md`), `# ${name}\n` + 'spec content. '.repeat(200));
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@truecourse.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'docs'], { cwd: repo });
  spawned.length = 0;
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('scan estimate — git independence', () => {
  it('prices every discovered doc without spawning git', async () => {
    const est = await estimateScanTokens(repo, undefined, { identity: null });

    expect(spawned).toEqual([]);
    expect(est.subjectLabel).toBe('3 docs');
    expect(est.stages!.find((s) => s.stage === 'relevance')!.calls).toBe(DOCS.length);

    // Control: the run's own discovery DOES pay it — one `git log` per doc — which
    // is precisely the work the estimate skips, over the same doc list.
    const docs = discoverDocs(repo);
    expect(docs.map((d) => d.path).sort()).toEqual(DOCS.map((n) => `docs/${n}.md`).sort());
    expect(spawned.filter((cmd) => cmd.startsWith('git log'))).toHaveLength(DOCS.length);
  });

  it('produces identical numbers with and without git history', async () => {
    const withHistory = await estimateScanTokens(repo, undefined, { identity: null });
    fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
    const withoutHistory = await estimateScanTokens(repo, undefined, { identity: null });

    expect(withoutHistory).toEqual(withHistory);
  });
});
