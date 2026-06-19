import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cachePaths,
  readBlockCache,
  writeBlockCache,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Cache tests pin the load-bearing properties:
 *
 *   - Block-cache is keyed by block.id (already content-addressed).
 *   - Reads from a missing or corrupt file return null silently.
 *   - Writes are atomic-ish (single fs.writeFileSync; no half-files).
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cache-'));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('block cache', () => {
  it('returns null for an unknown block id', async () => {
    expect(await readBlockCache(repoRoot, 'unknown')).toBeNull();
  });

  it('round-trips an extraction', async () => {
    await writeBlockCache(repoRoot, 'block-1', {
      topics: ['endpoints'],
      claims: [{ topic: 'endpoints', subject: 'POST /x', content: { method: 'POST' }, kind: 'definition' }],
    });
    const out = await readBlockCache(repoRoot, 'block-1');
    expect(out).not.toBeNull();
    expect(out!.claims[0].subject).toBe('POST /x');
  });

  it('returns null when the on-disk JSON is corrupt', async () => {
    const file = path.join(cachePaths(repoRoot).blocksDir, 'block-2.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not: "valid json"');
    expect(await readBlockCache(repoRoot, 'block-2')).toBeNull();
  });

  it('returns null when the JSON parses but fails the schema (rejects bad shapes)', async () => {
    const file = path.join(cachePaths(repoRoot).blocksDir, 'block-3.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ blockId: 'block-3', extraction: { topics: [], claims: 'not-an-array' } }));
    expect(await readBlockCache(repoRoot, 'block-3')).toBeNull();
  });
});

describe('cachePaths', () => {
  it('points at .truecourse/.cache/consolidator/blocks', () => {
    const paths = cachePaths(repoRoot);
    expect(paths.cacheDir).toBe(path.join(repoRoot, '.truecourse', '.cache', 'consolidator'));
    expect(paths.blocksDir).toBe(path.join(paths.cacheDir, 'blocks'));
  });
});
