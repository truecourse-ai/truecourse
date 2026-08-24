/**
 * The run logger's file sink is owned by whoever pushed it: the file is opened
 * synchronously by `pushLogger` and flushed + closed by the awaited `popLogger`,
 * so no fs work outlives the run. A repo directory that disappears mid-run (a
 * fixture teardown, a `git clean`, a deleted checkout) therefore cannot strand a
 * half-opened sink that fails later with nobody holding it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, popLogger, pushLogger } from '@truecourse/core/lib/logger';

describe('run logger lifecycle', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-logger-lifecycle-'));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const logFile = () => path.join(repo, '.truecourse/logs/analyze.log');

  it('opens the log file before pushLogger returns', async () => {
    pushLogger({ filePath: logFile() });
    // No pending open to outlive the caller: the file is there already.
    expect(fs.existsSync(logFile())).toBe(true);
    await popLogger();
  });

  it('writes the run to disk and closes the file when the run ends', async () => {
    pushLogger({ filePath: logFile() });
    log.info('[Analysis] one line');
    await popLogger();

    expect(fs.readFileSync(logFile(), 'utf8')).toMatch(/\[INFO] \[Analysis] one line/);
  });

  it('keeps logging and closes cleanly when the repo directory is removed mid-run', async () => {
    pushLogger({ filePath: logFile() });
    log.info('[Analysis] started');

    fs.rmSync(repo, { recursive: true, force: true });

    log.info('[Analysis] finished');
    await expect(popLogger()).resolves.toBeUndefined();
    expect(fs.existsSync(repo)).toBe(false);
  });

  it('reports an unopenable log file to the caller that pushed it', () => {
    fs.mkdirSync(logFile(), { recursive: true }); // the log path is a directory

    expect(() => pushLogger({ filePath: logFile() })).toThrow(/EISDIR/);
  });
});
