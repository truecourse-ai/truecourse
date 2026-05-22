import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parseEnvFile,
  writeEnvVar,
} from '../../tools/cli/src/commands/service/env';

describe('writeEnvVar', () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-env-'));
    envPath = path.join(tmpDir, '.env');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the file and its parent directory when neither exists', () => {
    const nested = path.join(tmpDir, 'nested', '.env');
    writeEnvVar(nested, 'PORT', '47821');
    const parsed = parseEnvFile(nested);
    expect(parsed.PORT).toBe('47821');
  });

  it('replaces an existing key in-place and preserves other keys', () => {
    fs.writeFileSync(envPath, 'PATH=/usr/local/bin\nPORT=3001\nTRUECOURSE_HOME=/tmp\n');
    writeEnvVar(envPath, 'PORT', '47821');
    const parsed = parseEnvFile(envPath);
    expect(parsed.PORT).toBe('47821');
    expect(parsed.PATH).toBe('/usr/local/bin');
    expect(parsed.TRUECOURSE_HOME).toBe('/tmp');
  });

  it('appends a new key with a trailing newline when missing', () => {
    fs.writeFileSync(envPath, 'PATH=/usr/local/bin');
    writeEnvVar(envPath, 'PORT', '47821');
    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
    expect(parseEnvFile(envPath).PORT).toBe('47821');
  });

  it('quotes values containing whitespace or hash characters', () => {
    writeEnvVar(envPath, 'NOTE', 'hello world');
    const raw = fs.readFileSync(envPath, 'utf-8');
    expect(raw).toContain('NOTE="hello world"');
    expect(parseEnvFile(envPath).NOTE).toBe('hello world');
  });

  it('does not falsely match keys with shared prefixes', () => {
    fs.writeFileSync(envPath, 'PORT=3001\nPORT_EXTRA=9999\n');
    writeEnvVar(envPath, 'PORT', '47821');
    const parsed = parseEnvFile(envPath);
    expect(parsed.PORT).toBe('47821');
    expect(parsed.PORT_EXTRA).toBe('9999');
  });
});
