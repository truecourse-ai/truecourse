import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { requireGitRepo } from '../../tools/cli/src/commands/git-guard';

let dir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-git-guard-'));
  // Make process.exit throw so the async guard stops and the test can assert.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  exitSpy.mockRestore();
  stdoutSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('requireGitRepo', () => {
  it('aborts with exit(1) when the directory is not a git repo', async () => {
    await expect(requireGitRepo(dir)).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('returns normally inside a git repo', async () => {
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t.co', { cwd: dir });
    execSync('git config user.name test', { cwd: dir });
    await expect(requireGitRepo(dir)).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
