import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readBlockCache,
  writeBlockCache,
  readSectionCache,
  writeSectionCache,
  sectionId,
  cachePaths,
  type Claim,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Cache tests pin the load-bearing properties:
 *
 *   - Block-cache is keyed by block.id (already content-addressed).
 *   - Section-cache key is derived from (module, topic, claims) and
 *     is order-independent — same claim set in any order ⇒ same id.
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

function makeClaim(id: string, content: unknown, status?: Claim['metadata']['status']): Claim {
  return {
    id,
    topic: 'endpoints',
    subject: 'POST /x',
    content,
    provenance: { file: 'docs/x.md', line: 1, quote: 'q' },
    metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z', status },
  };
}

describe('block cache', () => {
  it('returns null for an unknown block id', () => {
    expect(readBlockCache(repoRoot, 'unknown')).toBeNull();
  });

  it('round-trips an extraction', () => {
    writeBlockCache(repoRoot, 'block-1', {
      topics: ['endpoints'],
      claims: [{ topic: 'endpoints', subject: 'POST /x', content: { method: 'POST' }, kind: 'definition' }],
    });
    const out = readBlockCache(repoRoot, 'block-1');
    expect(out).not.toBeNull();
    expect(out!.claims[0].subject).toBe('POST /x');
  });

  it('returns null when the on-disk JSON is corrupt', () => {
    const file = path.join(cachePaths(repoRoot).blocksDir, 'block-2.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not: "valid json"');
    expect(readBlockCache(repoRoot, 'block-2')).toBeNull();
  });

  it('returns null when the JSON parses but fails the schema (rejects bad shapes)', () => {
    const file = path.join(cachePaths(repoRoot).blocksDir, 'block-3.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ blockId: 'block-3', extraction: { topics: [], claims: 'not-an-array' } }));
    expect(readBlockCache(repoRoot, 'block-3')).toBeNull();
  });
});

describe('section cache', () => {
  it('section id is order-independent over the claims array', () => {
    const a = makeClaim('id-a', { v: 1 });
    const b = makeClaim('id-b', { v: 2 });
    const k1 = { module: 'auth', topic: 'endpoints' as const, fileName: 'endpoints.md', claims: [a, b] };
    const k2 = { module: 'auth', topic: 'endpoints' as const, fileName: 'endpoints.md', claims: [b, a] };
    expect(sectionId(k1)).toBe(sectionId(k2));
  });

  it('section id changes when a claim\'s content changes', () => {
    const a1 = makeClaim('id-a', { v: 1 });
    const a2 = makeClaim('id-a', { v: 2 });
    const k1 = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [a1] });
    const k2 = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [a2] });
    expect(k1).not.toBe(k2);
  });

  it('section id changes when status flips on the same claim', () => {
    const shipped = makeClaim('id-a', { v: 1 }, 'shipped');
    const planned = makeClaim('id-a', { v: 1 }, 'planned');
    const k1 = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [shipped] });
    const k2 = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [planned] });
    expect(k1).not.toBe(k2);
  });

  it('section id changes when module or topic differs', () => {
    const c = makeClaim('id-a', { v: 1 });
    const k1 = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [c] });
    const k2 = sectionId({ module: 'health', topic: 'endpoints', fileName: 'endpoints.md', claims: [c] });
    const k3 = sectionId({ module: 'auth', topic: 'data', fileName: 'data.md', claims: [c] });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('round-trips rendered markdown', () => {
    const c = makeClaim('id-a', { v: 1 });
    const id = sectionId({ module: 'auth', topic: 'endpoints', fileName: 'endpoints.md', claims: [c] });
    writeSectionCache(repoRoot, id, {
      module: 'auth',
      topic: 'endpoints',
      fileName: 'endpoints.md',
      markdown: '# Endpoints\n\n- POST /x\n',
    });
    expect(readSectionCache(repoRoot, id)).toBe('# Endpoints\n\n- POST /x\n');
  });

  it('returns null on miss', () => {
    expect(readSectionCache(repoRoot, 'unknown-id')).toBeNull();
  });
});

describe('cachePaths', () => {
  it('points at .truecourse/.cache/consolidator/{blocks,sections}', () => {
    const paths = cachePaths(repoRoot);
    expect(paths.cacheDir).toBe(path.join(repoRoot, '.truecourse', '.cache', 'consolidator'));
    expect(paths.blocksDir).toBe(path.join(paths.cacheDir, 'blocks'));
    expect(paths.sectionsDir).toBe(path.join(paths.cacheDir, 'sections'));
  });
});
