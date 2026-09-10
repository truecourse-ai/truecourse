/**
 * The file log sink must never take the process down: a log directory removed
 * mid-run (an ephemeral clone swept, a test fixture torn down) fails the
 * stream, and that failure is reported once and absorbed, with later lines
 * going to stderr instead.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileLogTransport } from '@truecourse/core/lib/logger';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-logger-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('FileLogTransport', () => {
  it('writes lines to the file and closes cleanly', async () => {
    const filePath = path.join(dir, 'logs', 'analyze.log');
    const transport = new FileLogTransport({ filePath });
    transport.write('info', 'hello');
    await transport.close();
    expect(fs.readFileSync(filePath, 'utf8')).toContain('hello');
  });

  it('absorbs a failed sink, reports it once to stderr, and keeps logging there', async () => {
    const filePath = path.join(dir, 'logs', 'analyze.log');
    const transport = new FileLogTransport({ filePath });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stream = (transport as unknown as { stream: fs.WriteStream }).stream;

    stream.emit('error', new Error('ENOENT: no such file or directory'));
    stream.emit('error', new Error('ENOENT: no such file or directory'));
    transport.write('warn', 'after the failure');
    await transport.close();

    const written = stderr.mock.calls.map(([chunk]) => String(chunk));
    expect(written.filter((line) => line.includes('unavailable'))).toHaveLength(1);
    expect(written.some((line) => line.includes('after the failure'))).toBe(true);
  });
});
