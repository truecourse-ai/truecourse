/**
 * The file log sink must never kill the process over its own diagnostics. A
 * write stream with no `error` listener rethrows as an uncaught exception, so a
 * log file whose directory goes away under a running command (an ephemeral
 * clone disposed while the run is still unwinding) would take the process with
 * it. It says so once on stderr and goes quiet instead.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileLogTransport } from '../../packages/core/src/lib/logger';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

/** Wait for the stream's async `error` event to land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('the file log sink', () => {
  it('writes its lines to the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-logger-'));
    dirs.push(dir);
    const file = path.join(dir, 'logs', 'analyze.log');
    const transport = new FileLogTransport({ filePath: file });

    transport.write('info', 'hello');
    await transport.close();

    expect(fs.readFileSync(file, 'utf-8')).toContain('hello');
  });

  it('survives its directory vanishing, and says so once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-logger-'));
    dirs.push(dir);
    const file = path.join(dir, 'logs', 'analyze.log');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const transport = new FileLogTransport({ filePath: file });
    fs.rmSync(dir, { recursive: true, force: true });
    // The stream opens lazily: the first write is what fails.
    transport.write('info', 'after the tree went');
    await settle();
    transport.write('info', 'and again');
    await settle();

    const lines = stderr.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes('is not writable'))).toHaveLength(1);
    expect(lines[0]).toContain(file);
  });
});
