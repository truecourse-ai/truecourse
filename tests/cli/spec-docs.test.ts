/**
 * `spec docs exclude|include <path...>` — the batch model: any number of paths are
 * validated + persisted to decisions.json first, then ONE re-curate runs at the end
 * (recording five docs costs one scan, not five). The re-curate is mocked to a no-op
 * so the test asserts the CALL COUNT, not the engine (curate has its own suite).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return { ...actual, curateInProcess: vi.fn(async () => ({ noChanges: false })) };
});

import { runSpecDocsExclude, runSpecDocsInclude } from '../../tools/cli/src/commands/spec-docs.js';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';

let repo: string;

const readDecisions = (): { manualIncludes?: string[]; manualExcludes?: string[] } =>
  JSON.parse(fs.readFileSync(path.join(repo, '.truecourse', 'specs', 'decisions.json'), 'utf8'));

/** Run a command, swallowing its clack stdout. */
async function silence(fn: () => Promise<void>): Promise<void> {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-docs-'));
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  vi.mocked(curateInProcess).mockClear();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec docs exclude (batch)', () => {
  it('records every path and re-curates exactly once', async () => {
    await silence(() => runSpecDocsExclude(['docs/v1.md', 'docs/v2.md'], { cwd: repo }));
    expect(readDecisions().manualExcludes).toEqual(expect.arrayContaining(['docs/v1.md', 'docs/v2.md']));
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(1);
  });

  it('a single path still records + re-curates once (unchanged in effect)', async () => {
    await silence(() => runSpecDocsExclude(['docs/v1.md'], { cwd: repo }));
    expect(readDecisions().manualExcludes).toEqual(['docs/v1.md']);
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(1);
  });
});

describe('spec docs include (batch)', () => {
  it('records every path and re-curates exactly once', async () => {
    await silence(() => runSpecDocsInclude(['docs/a.md', 'docs/b.md', 'docs/c.md'], { cwd: repo }));
    expect(readDecisions().manualIncludes).toEqual(expect.arrayContaining(['docs/a.md', 'docs/b.md', 'docs/c.md']));
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(1);
  });
});
