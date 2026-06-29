/**
 * Corpus-path decision helpers: addRelation / removeRelation. These are the
 * write verbs the `spec conflicts resolve` + `spec chains add/remove` CLI
 * commands delegate to. They persist user-authored doc→doc relations to
 * decisions.json (replace / precedence / keep-both), deduped per (older, newer,
 * scope), with `detectedFrom: 'manual'`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRelation, removeRelation } from '../../packages/core/src/commands/spec-in-process.js';
import { readCorpusDecisions } from '../../packages/spec-consolidator/src/index.js';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-relation-'));
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const rels = () => readCorpusDecisions(repo).relations ?? [];

describe('addRelation', () => {
  it('persists a user relation with detectedFrom manual', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md' });
    expect(rels()).toEqual([
      { type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'manual' },
    ]);
  });

  it('keeps the caller-provided scope and note', async () => {
    await addRelation(repo, { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/auth', note: 'v2 wins' });
    expect(rels()[0]).toMatchObject({ type: 'precedence', scope: 'core/auth', note: 'v2 wins', detectedFrom: 'manual' });
  });

  it('replaces an existing relation for the same (older, newer, scope)', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    await addRelation(repo, { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    expect(rels()).toHaveLength(1);
    expect(rels()[0].type).toBe('precedence');
  });

  it('re-resolving the same pair REPLACES it, even when the direction flips', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    await addRelation(repo, { type: 'precedence', older: 'b.md', newer: 'a.md', scope: 'core/auth' }); // flipped + new type
    expect(rels()).toHaveLength(1);
    expect(rels()[0]).toMatchObject({ type: 'precedence', older: 'b.md', newer: 'a.md' });
  });

  it('keeps relations for the same pair under DIFFERENT scopes', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/orders' });
    expect(rels()).toHaveLength(2);
  });

  it('rejects a self-pair', async () => {
    await expect(addRelation(repo, { type: 'replace', older: 'a.md', newer: 'a.md' })).rejects.toThrow();
  });
});

describe('removeRelation', () => {
  it('drops the matching relation, either order', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md' });
    await removeRelation(repo, { older: 'b.md', newer: 'a.md' });
    expect(rels()).toEqual([]);
  });

  it('scope omitted removes every relation for the pair', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/orders' });
    await removeRelation(repo, { older: 'a.md', newer: 'b.md' });
    expect(rels()).toEqual([]);
  });

  it('scope provided removes only that scope', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/orders' });
    await removeRelation(repo, { older: 'a.md', newer: 'b.md', scope: 'core/auth' });
    expect(rels()).toHaveLength(1);
    expect(rels()[0].scope).toBe('core/orders');
  });

  it('is idempotent when nothing matches', async () => {
    await removeRelation(repo, { older: 'x.md', newer: 'y.md' });
    expect(rels()).toEqual([]);
  });
});
