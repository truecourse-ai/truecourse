import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSpecsConfig,
  resolveSpecEntry,
  writeSpecsConfig,
} from '../../packages/contract-extractor/src/specs-config.js';

describe('specs.yaml loader', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-specs-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null when the config file is missing', () => {
    expect(readSpecsConfig(tmpRoot)).toBeNull();
  });

  it('round-trips a config through write+read', () => {
    const config = {
      specs: [
        { file: 'SPEC.md', rank: 0 },
        { file: 'docs/adr/*.md', rank: 1 },
      ],
    };
    writeSpecsConfig(tmpRoot, config);
    const back = readSpecsConfig(tmpRoot);
    expect(back).toEqual(config);
  });

  it('resolves a literal file entry', () => {
    fs.writeFileSync(path.join(tmpRoot, 'SPEC.md'), 'hi');
    const files = resolveSpecEntry(tmpRoot, { file: 'SPEC.md', rank: 0 });
    expect(files).toEqual([path.join(tmpRoot, 'SPEC.md')]);
  });

  it('expands a single-star glob within one segment', () => {
    fs.mkdirSync(path.join(tmpRoot, 'docs', 'adr'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'docs', 'adr', '0001-foo.md'), '');
    fs.writeFileSync(path.join(tmpRoot, 'docs', 'adr', '0002-bar.md'), '');
    fs.writeFileSync(path.join(tmpRoot, 'docs', 'adr', 'README.notmd'), '');

    const files = resolveSpecEntry(tmpRoot, { file: 'docs/adr/*.md', rank: 1 });
    expect(files).toEqual([
      path.join(tmpRoot, 'docs', 'adr', '0001-foo.md'),
      path.join(tmpRoot, 'docs', 'adr', '0002-bar.md'),
    ]);
  });

  it('expands a double-star glob recursively', () => {
    fs.mkdirSync(path.join(tmpRoot, 'docs', 'adr', 'archived'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'docs', 'adr', 'a.md'), '');
    fs.writeFileSync(path.join(tmpRoot, 'docs', 'adr', 'archived', 'b.md'), '');

    const files = resolveSpecEntry(tmpRoot, { file: 'docs/**/*.md', rank: 1 });
    expect(files).toContain(path.join(tmpRoot, 'docs', 'adr', 'a.md'));
    expect(files).toContain(path.join(tmpRoot, 'docs', 'adr', 'archived', 'b.md'));
  });

  it('refuses absolute paths', () => {
    expect(() => resolveSpecEntry(tmpRoot, { file: '/etc/passwd', rank: 0 })).toThrow();
  });

  it('returns an empty list when the literal target is missing', () => {
    expect(resolveSpecEntry(tmpRoot, { file: 'nope.md', rank: 0 })).toEqual([]);
  });
});
