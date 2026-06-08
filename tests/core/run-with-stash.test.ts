import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runWithStash } from '../../packages/core/src/lib/git';

// `runWithStash` is the shared full-mode stash behind `analyze` and `verify`.
// The defining property (issue #542): it stashes uncommitted *code* so the run
// sees committed state, but it must NEVER sweep TrueCourse's own `.truecourse/`
// working dir — that dir holds the contracts `verify` is about to read.

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-run-with-stash-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.co', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
}

function commitFile(dir: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(dir, name), contents);
  execSync(`git add ${name}`, { cwd: dir });
  execSync(`git commit -q -m ${name}`, { cwd: dir });
}

describe('runWithStash', () => {
  it('stashes dirty tracked code but never sweeps .truecourse/ (issue #542)', async () => {
    gitInit(repo);
    const tracked = path.join(repo, 'app.ts');
    commitFile(repo, 'app.ts', 'export const x = 1;\n');
    fs.writeFileSync(tracked, 'export const x = 2;\n'); // dirty tracked edit

    // TrueCourse's own untracked working dir, exactly as `contracts generate`
    // leaves it in a repo that hasn't committed `.truecourse/`.
    const contract = path.join(repo, '.truecourse', 'contracts', 'op.tc');
    fs.mkdirSync(path.dirname(contract), { recursive: true });
    fs.writeFileSync(contract, 'operation X\n');

    let codeDuringRun = '';
    let contractPresentDuringRun = false;
    await runWithStash(repo, { skipStash: false, message: 'tc-test' }, async () => {
      codeDuringRun = fs.readFileSync(tracked, 'utf-8');
      contractPresentDuringRun = fs.existsSync(contract);
    });

    // Inside the run: committed code is visible (dirty edit was stashed)…
    expect(codeDuringRun).toBe('export const x = 1;\n');
    // …but the contract survived (`.truecourse/` was excluded from the stash).
    expect(contractPresentDuringRun).toBe(true);

    // After the run: the dirty edit is restored, contract still present.
    expect(fs.readFileSync(tracked, 'utf-8')).toBe('export const x = 2;\n');
    expect(fs.existsSync(contract)).toBe(true);
  });

  it('skipStash: runs fn against the working tree as-is', async () => {
    gitInit(repo);
    const tracked = path.join(repo, 'app.ts');
    commitFile(repo, 'app.ts', 'committed\n');
    fs.writeFileSync(tracked, 'dirty\n');

    let during = '';
    await runWithStash(repo, { skipStash: true, message: 'x' }, async () => {
      during = fs.readFileSync(tracked, 'utf-8');
    });
    expect(during).toBe('dirty\n'); // not stashed
  });

  it('clean tree: runs fn without stashing and returns its result', async () => {
    gitInit(repo);
    execSync('git commit -q --allow-empty -m init', { cwd: repo });
    const result = await runWithStash(repo, { skipStash: false, message: 'x' }, async () => 42);
    expect(result).toBe(42);
  });

  it('non-git dir: swallows the stash error and still runs fn', async () => {
    // `repo` here is a plain tmp dir (no git init).
    let ran = false;
    let stashErr: Error | undefined;
    await runWithStash(
      repo,
      { skipStash: false, message: 'x', onStashError: (e) => (stashErr = e) },
      async () => {
        ran = true;
      },
    );
    expect(ran).toBe(true);
    expect(stashErr).toBeInstanceOf(Error);
  });
});
