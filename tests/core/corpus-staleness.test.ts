/**
 * isCorpusStale — the manifest-based (content, not mtime) staleness signal for
 * the dashboard Generate dot. Deterministic, no LLM.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCorpusStale } from '../../packages/core/src/commands/spec-in-process.js';
import {
  readCorpusForGenerate,
  buildManifest,
  writeManifest,
} from '../../packages/contract-extractor/src/index.js';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stale-'));
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

function writeCorpus(docBody: string): void {
  const specs = path.join(repo, '.truecourse', 'specs');
  fs.mkdirSync(specs, { recursive: true });
  fs.writeFileSync(
    path.join(specs, 'corpus.json'),
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/orders'] }],
      areas: [{ id: 'core/orders', product: 'core', concern: 'orders', docRefs: ['docs/v1.md'], overlaps: [] }],
      relations: [],
    }),
  );
  const d = path.join(repo, 'docs');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'v1.md'), docBody);
}

describe('isCorpusStale', () => {
  it('no corpus → not stale', () => {
    expect(isCorpusStale(repo)).toBe(false);
  });

  it('corpus but no manifest (never generated) → stale', () => {
    writeCorpus('# Orders\nbody');
    expect(isCorpusStale(repo)).toBe(true);
  });

  it('manifest matches the corpus → not stale (survives an mtime bump)', () => {
    writeCorpus('# Orders\nbody');
    writeManifest(repo, buildManifest(readCorpusForGenerate(repo)));
    expect(isCorpusStale(repo)).toBe(false);

    // Rewriting corpus.json with identical content (a no-op scan) must NOT flip
    // it stale — the manifest is content-based, not mtime-based.
    writeCorpus('# Orders\nbody');
    expect(isCorpusStale(repo)).toBe(false);
  });

  it('edited doc → stale again', () => {
    writeCorpus('# Orders\nbody');
    writeManifest(repo, buildManifest(readCorpusForGenerate(repo)));
    expect(isCorpusStale(repo)).toBe(false);
    writeCorpus('# Orders\nCHANGED body');
    expect(isCorpusStale(repo)).toBe(true);
  });
});
