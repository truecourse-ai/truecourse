/**
 * `mergeDecisions` folds a PR's decisions overlay over the repo row (the overlay
 * wins on every dimension), and the PR-scoped decision APIs are enterprise-only —
 * the OSS file store has no commit dimension, so a PR-scoped ref must fail loud.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeDecisions,
  addRelation,
  addManualInclude,
  getDecisions,
} from '../../packages/core/src/commands/spec-in-process';
import { resetSpecStore } from '../../packages/core/src/lib/spec-store';
import type { DecisionsFile } from '@truecourse/spec-consolidator';

const empty: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  manualExcludes: [],
  relations: [],
  manualAreas: [],
};

const decisions = (over: Partial<DecisionsFile>): DecisionsFile => ({ ...empty, ...over });

describe('mergeDecisions — relations', () => {
  it('overlay relation replaces the base one for the same pair + scope', () => {
    const base = decisions({
      relations: [{ type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/x', detectedFrom: 'llm' }],
    });
    const overlay = decisions({
      relations: [{ type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/x', detectedFrom: 'manual' }],
    });
    const merged = mergeDecisions(base, overlay);
    expect(merged.relations).toEqual([
      { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/x', detectedFrom: 'manual' },
    ]);
  });

  it('replacement is order-insensitive on the doc pair', () => {
    const base = decisions({ relations: [{ type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/x' }] });
    const overlay = decisions({ relations: [{ type: 'keep-both', older: 'b.md', newer: 'a.md', scope: 'core/x' }] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.relations).toHaveLength(1);
    expect(merged.relations[0]).toMatchObject({ type: 'keep-both', older: 'b.md', newer: 'a.md' });
  });

  it('keeps base relations for other pairs and other scopes', () => {
    const base = decisions({
      relations: [
        { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/x' },
        { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/y' },
        { type: 'replace', older: 'c.md', newer: 'd.md' },
      ],
    });
    const overlay = decisions({ relations: [{ type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/x' }] });
    const merged = mergeDecisions(base, overlay);
    // core/x replaced; core/y and the c/d pair survive.
    expect(merged.relations).toHaveLength(3);
    expect(merged.relations.filter((r) => r.older === 'a.md' && r.scope === 'core/x')).toEqual([
      { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/x' },
    ]);
    expect(merged.relations.some((r) => r.scope === 'core/y')).toBe(true);
    expect(merged.relations.some((r) => r.older === 'c.md')).toBe(true);
  });
});

describe('mergeDecisions — includes/excludes (overlay verb wins per path)', () => {
  it('unions includes and excludes across scopes', () => {
    const base = decisions({ manualIncludes: ['a.md'], manualExcludes: ['b.md'] });
    const overlay = decisions({ manualIncludes: ['c.md'], manualExcludes: ['d.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualIncludes.sort()).toEqual(['a.md', 'c.md']);
    expect(merged.manualExcludes.sort()).toEqual(['b.md', 'd.md']);
  });

  it('overlay exclude wins over a base include for the same path', () => {
    const base = decisions({ manualIncludes: ['x.md'] });
    const overlay = decisions({ manualExcludes: ['x.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualExcludes).toEqual(['x.md']);
    expect(merged.manualIncludes).not.toContain('x.md');
  });

  it('overlay include wins over a base exclude for the same path', () => {
    const base = decisions({ manualExcludes: ['x.md'] });
    const overlay = decisions({ manualIncludes: ['x.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualIncludes).toEqual(['x.md']);
    expect(merged.manualExcludes).not.toContain('x.md');
  });

  it('dedups a path present in both base and overlay', () => {
    const base = decisions({ manualIncludes: ['x.md'] });
    const overlay = decisions({ manualIncludes: ['x.md'] });
    expect(mergeDecisions(base, overlay).manualIncludes).toEqual(['x.md']);
  });
});

describe('mergeDecisions — manualAreas (overlay wins per doc)', () => {
  it('overlay override replaces the base area for that doc; other docs survive', () => {
    const base = decisions({
      manualAreas: [
        { doc: 'a.md', areas: ['core/x'] },
        { doc: 'b.md', areas: ['core/y'] },
      ],
    });
    const overlay = decisions({ manualAreas: [{ doc: 'a.md', areas: ['core/z'] }] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualAreas).toContainEqual({ doc: 'a.md', areas: ['core/z'] });
    expect(merged.manualAreas).toContainEqual({ doc: 'b.md', areas: ['core/y'] });
    expect(merged.manualAreas).toHaveLength(2);
  });
});

describe('mergeDecisions — empty overlay is a no-op', () => {
  it('an empty overlay returns the base content', () => {
    const base = decisions({
      manualIncludes: ['a.md'],
      manualExcludes: ['b.md'],
      relations: [{ type: 'replace', older: 'a.md', newer: 'b.md' }],
      manualAreas: [{ doc: 'a.md', areas: ['core/x'] }],
    });
    const merged = mergeDecisions(base, empty);
    expect(merged.manualIncludes).toEqual(['a.md']);
    expect(merged.manualExcludes).toEqual(['b.md']);
    expect(merged.relations).toHaveLength(1);
    expect(merged.manualAreas).toEqual([{ doc: 'a.md', areas: ['core/x'] }]);
  });
});

describe('PR-scoped decisions are enterprise-only on the file store', () => {
  let repo: string;
  beforeEach(() => {
    resetSpecStore(); // file-backed default (OSS)
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pr-decisions-'));
    fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  });
  afterEach(() => {
    resetSpecStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('a mutation helper with a PR opt rejects (no overlay dimension in OSS)', async () => {
    await expect(
      addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 1 }),
    ).rejects.toThrow(/enterprise store/);
    await expect(addManualInclude(repo, 'a.md', { pr: 1 })).rejects.toThrow(/enterprise store/);
  });

  it('getDecisions with a PR opt rejects on the file store', async () => {
    await expect(getDecisions(repo, { pr: 1 })).rejects.toThrow(/enterprise store/);
  });

  it('getDecisions without a PR opt is the repo row (unchanged OSS behavior)', async () => {
    await addRelation(repo, { type: 'replace', older: 'a.md', newer: 'b.md' });
    const d = await getDecisions(repo);
    expect(d.relations).toHaveLength(1);
  });
});
