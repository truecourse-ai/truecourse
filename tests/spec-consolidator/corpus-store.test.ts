/**
 * corpus.json round-trips through the same write-then-read path the dashboard +
 * generate stages use, and fail-soft reads return null on corruption rather
 * than throwing mid-scan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeCorpus,
  readCorpus,
  hasCorpus,
  corpusFilePath,
} from '../../packages/spec-consolidator/src/index.js';
import type { Area, CorpusDoc, Relation } from '../../packages/spec-consolidator/src/index.js';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-corpus-store-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const docs: CorpusDoc[] = [
  {
    ref: 'docs/0003-users.md',
    kind: 'prd',
    status: 'shipped',
    lastTouched: '2026-01-01T00:00:00Z',
    areaTags: ['core/users-entity', 'core/auth'],
  },
];
const areas: Area[] = [
  {
    id: 'core/users-entity',
    product: 'core',
    concern: 'users-entity',
    docRefs: ['docs/0003-users.md'],
    overlaps: [{ docs: ['docs/0003-users.md', 'docs/0008-users.md'], note: 'auth0_id vs auth0_sub' }],
  },
];
const relations: Relation[] = [
  { type: 'replace', older: 'docs/v1.md', newer: 'docs/v2.md', detectedFrom: 'filename' },
];

describe('corpus-store', () => {
  it('round-trips a corpus', () => {
    expect(hasCorpus(repo)).toBe(false);
    writeCorpus(repo, { docs, areas, relations });
    expect(hasCorpus(repo)).toBe(true);

    const read = readCorpus(repo);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(3);
    expect(read!.docs).toEqual(docs);
    expect(read!.areas).toEqual(areas);
    expect(read!.relations).toEqual(relations);
    expect(typeof read!.generatedAt).toBe('string');
  });

  it('writes to .truecourse/specs/corpus.json', () => {
    writeCorpus(repo, { docs, areas, relations });
    expect(corpusFilePath(repo)).toBe(path.join(repo, '.truecourse', 'specs', 'corpus.json'));
    expect(fs.existsSync(corpusFilePath(repo))).toBe(true);
  });

  it('returns null on a corrupt file', () => {
    fs.mkdirSync(path.dirname(corpusFilePath(repo)), { recursive: true });
    fs.writeFileSync(corpusFilePath(repo), '{ not json');
    expect(readCorpus(repo)).toBeNull();
  });

  it('returns null when absent', () => {
    expect(readCorpus(repo)).toBeNull();
  });
});
