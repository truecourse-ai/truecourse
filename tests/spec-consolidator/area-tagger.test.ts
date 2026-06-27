/**
 * The per-doc area tagger mirrors the relevance filter's seams: an injectable
 * runner, content-hash caching (so unchanged docs cost zero tokens and keep the
 * corpus stable), graceful per-doc degradation, and a deterministic header
 * status fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { tagDocs, parseDocStatus } from '../../packages/spec-consolidator/src/index.js';
import type { AreaTagRunner, DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content?: string): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content?.split('\n').slice(0, 5).join('\n') ?? 'preview',
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}-${content?.length ?? 0}`,
    size: 100,
  };
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-areatag-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const tagAuth: AreaTagRunner = async ({ doc }) => ({
  tags: [{ product: 'core', concern: 'auth' }],
  status: 'shipped',
});

describe('tagDocs', () => {
  it('returns the runner verdict keyed by doc path', async () => {
    const out = await tagDocs(repo, [doc('a.md'), doc('b.md')], { runner: tagAuth });
    expect(out.get('a.md')).toEqual({ tags: [{ product: 'core', concern: 'auth' }], status: 'shipped' });
    expect(out.get('b.md')?.tags).toHaveLength(1);
  });

  it('caches per doc — a second run with unchanged docs does not call the runner', async () => {
    let calls = 0;
    const runner: AreaTagRunner = async ({ doc }) => {
      calls++;
      return { tags: [{ product: 'core', concern: 'auth' }] };
    };
    const docs = [doc('a.md'), doc('b.md')];
    await tagDocs(repo, docs, { runner });
    expect(calls).toBe(2);
    await tagDocs(repo, docs, { runner });
    expect(calls).toBe(2); // both served from cache
  });

  it('degrades a failed doc to empty tags + header-status fallback', async () => {
    const runner: AreaTagRunner = async () => {
      throw new Error('boom');
    };
    const out = await tagDocs(repo, [doc('a.md', 'Status: shipped\n# Title\nbody')], { runner });
    expect(out.get('a.md')).toEqual({ tags: [], status: 'shipped' });
  });

  it('falls back to the header status when the runner omits it', async () => {
    const runner: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'auth' }] });
    const out = await tagDocs(repo, [doc('a.md', '# Title\nStatus: planned\n')], { runner });
    expect(out.get('a.md')?.status).toBe('planned');
  });

  it('keeps the runner status when it supplies one (no override from header)', async () => {
    const runner: AreaTagRunner = async () => ({
      tags: [{ product: 'core', concern: 'auth' }],
      status: 'deferred',
    });
    const out = await tagDocs(repo, [doc('a.md', 'Status: shipped\n')], { runner });
    expect(out.get('a.md')?.status).toBe('deferred');
  });

  it('does not hang when concurrency is 0 (clamped to >=1)', async () => {
    const out = await tagDocs(repo, [doc('a.md'), doc('b.md')], { runner: tagAuth, concurrency: 0 });
    expect(out.size).toBe(2);
    expect(out.get('a.md')?.tags).toHaveLength(1);
  });

  it('returns empty tags for every doc when disabled', async () => {
    let calls = 0;
    const runner: AreaTagRunner = async () => {
      calls++;
      return { tags: [{ product: 'core', concern: 'auth' }] };
    };
    const out = await tagDocs(repo, [doc('a.md')], { runner, enabled: false });
    expect(out.get('a.md')).toEqual({ tags: [] });
    expect(calls).toBe(0);
  });

  it('reports progress (initial 0/total, then one per doc)', async () => {
    const calls: Array<[number, number]> = [];
    await tagDocs(repo, [doc('a.md'), doc('b.md'), doc('c.md')], {
      runner: tagAuth,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls[0]).toEqual([0, 3]);
    expect(calls).toHaveLength(4);
    expect(calls[calls.length - 1]).toEqual([3, 3]);
  });
});

describe('parseDocStatus', () => {
  it('reads a canonical Status line', () => {
    expect(parseDocStatus('# Title\nStatus: shipped\n')).toBe('shipped');
  });
  it('maps common phrasings to canonical statuses', () => {
    expect(parseDocStatus('Status: Done')).toBe('shipped');
    expect(parseDocStatus('Status: Draft')).toBe('planned');
    expect(parseDocStatus('Status: Deprecated')).toBe('deprecated');
    expect(parseDocStatus('**Status:** Out of scope')).toBe('out-of-scope');
  });
  it('handles bulleted / bold frontmatter forms', () => {
    expect(parseDocStatus('- **Status**: planned')).toBe('planned');
  });
  it('returns undefined when no status is stated', () => {
    expect(parseDocStatus('# Title\njust prose\n')).toBeUndefined();
  });
  it('only scans the header window', () => {
    const body = ['# Title', ...Array(60).fill('filler'), 'Status: shipped'].join('\n');
    expect(parseDocStatus(body)).toBeUndefined();
  });
  it('does not let incidental shipped-words override a governing planned/terminal state', () => {
    expect(parseDocStatus('Status: planned, will go live in Q4')).toBe('planned');
    expect(parseDocStatus('Status: draft, targeting GA in Q3')).toBe('planned');
    expect(parseDocStatus('Status: completed, now deprecated')).toBe('deprecated');
  });
  it('keeps scanning past an unrecognized status line to a clearer one', () => {
    expect(parseDocStatus('Status: ![badge](https://x/y.svg)\nStatus: shipped\n')).toBe('shipped');
  });
});
