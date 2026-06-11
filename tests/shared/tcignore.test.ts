import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTcIgnore, findRepoRoot } from '../../packages/shared/src/index.js';

/**
 * `.truecourseignore` is the single ignore mechanism shared by code
 * analysis, the spec doc-scan, and the verifier's code walkers. The
 * load-bearing properties: gitignore-style matching, root-anchored
 * patterns (so a subdirectory caller resolves the same root), and never
 * ignoring paths outside that root.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ign-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadTcIgnore', () => {
  it('ignores nothing when no .truecourseignore exists', () => {
    const ig = loadTcIgnore(root);
    expect(ig.ignores(path.join(root, 'reference/x.md'))).toBe(false);
  });

  it('matches gitignore-style patterns relative to the repo root', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), 'reference/\n**/*.gen.ts\n');
    const ig = loadTcIgnore(root);
    expect(ig.ignores(path.join(root, 'reference/specs/a.md'))).toBe(true);
    expect(ig.ignores(path.join(root, 'src/api.gen.ts'))).toBe(true);
    expect(ig.ignores(path.join(root, 'src/api.ts'))).toBe(false);
  });

  it('anchors at the repo root even when called from a subdirectory', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), 'reference/\n');
    const sub = path.join(root, 'code', 'src');
    fs.mkdirSync(sub, { recursive: true });
    const ig = loadTcIgnore(sub);
    expect(ig.root).toBe(root);
    expect(ig.ignores(path.join(root, 'reference/x.md'))).toBe(true);
    expect(ig.ignores(path.join(sub, 'app.ts'))).toBe(false);
  });

  it('never ignores paths outside the repo root', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), '*\n');
    const ig = loadTcIgnore(root);
    expect(ig.ignores(path.join(path.dirname(root), 'sibling.md'))).toBe(false);
  });
});

describe('TcIgnore.reincludes', () => {
  it('is true only for paths explicitly re-included by a negation rule', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), '*.md\n!docs/build/**\n');
    const ig = loadTcIgnore(root);
    // Re-included subtree (and nested descendants via `**`).
    expect(ig.reincludes(path.join(root, 'docs/build/x.md'))).toBe(true);
    expect(ig.reincludes(path.join(root, 'docs/build/assets/y.md'))).toBe(true);
    // Ignored-but-not-re-included (a plain `*.md` match) → false.
    expect(ig.reincludes(path.join(root, 'docs/other.md'))).toBe(false);
    // A path no rule mentions at all → false (no opinion ≠ re-included).
    expect(ig.reincludes(path.join(root, 'src/app.ts'))).toBe(false);
  });

  it('returns false when there is no .truecourseignore', () => {
    const ig = loadTcIgnore(root);
    expect(ig.reincludes(path.join(root, 'docs/build/x.md'))).toBe(false);
  });

  it('never re-includes paths outside the repo root', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), '!**\n');
    const ig = loadTcIgnore(root);
    expect(ig.reincludes(path.join(path.dirname(root), 'sibling.md'))).toBe(false);
  });
});

describe('findRepoRoot', () => {
  it('stops at the directory holding .truecourseignore', () => {
    fs.writeFileSync(path.join(root, '.truecourseignore'), 'x\n');
    const sub = path.join(root, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(root);
  });

  it('treats a .truecourse directory as a root marker', () => {
    fs.mkdirSync(path.join(root, '.truecourse'), { recursive: true });
    const sub = path.join(root, 'a');
    fs.mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(root);
  });
});
