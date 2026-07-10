/**
 * Overlap flagging examines unresolved within-area doc pairs and surfaces the
 * disagreements for the user. Pairs already covered by a relation (global or
 * area-scoped) are skipped; the per-area pair count is capped (reported, never
 * silently dropped); and verdicts cache per pair.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { flagOverlaps } from '../../packages/spec-consolidator/src/index.js';
import type { Area, DocCandidate, OverlapRunner, Relation } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

function area(id: string, refs: string[]): Area {
  const slash = id.indexOf('/');
  return {
    id,
    product: id.slice(0, slash),
    concern: id.slice(slash + 1),
    docRefs: refs,
    overlaps: [],
  };
}

const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-overlap-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('flagOverlaps', () => {
  it('flags a disagreeing pair', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner: flagAll });
    expect(out.get('core/auth')).toEqual([{ docs: ['a.md', 'b.md'], note: 'a.md vs b.md', sections: [], areas: ['core/auth'] }]);
  });

  it('carries the conflicting sections the runner reports', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'window differs',
      sections: [
        { doc: a.path, heading: 'Cancellation' },
        { doc: b.path, heading: 'Refunds' },
      ],
    });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.get('core/auth')?.[0].sections).toEqual([
      { doc: 'a.md', heading: 'Cancellation' },
      { doc: 'b.md', heading: 'Refunds' },
    ]);
  });

  it('carries a preamble section pointer (null heading) through the cache round-trip', async () => {
    const docs = [doc('README.md'), doc('docs/PLAN.md')];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'README preamble lists C#; PLAN omits it',
      sections: [
        { doc: a.path, heading: null },
        { doc: b.path, heading: 'Tech Stack' },
      ],
    });
    const out = await flagOverlaps(repo, [area('core/languages', ['README.md', 'docs/PLAN.md'])], docs, { runner });
    expect(out.get('core/languages')?.[0].sections).toEqual([
      { doc: 'README.md', heading: null },
      { doc: 'docs/PLAN.md', heading: 'Tech Stack' },
    ]);
  });

  it('the default LLM runner maps a null-heading (preamble) side into the verdict', async () => {
    const docs = [doc('README.md'), doc('docs/PLAN.md')];
    // Side A sits in the preamble → heading null; side B is under a heading.
    const transport = async (): Promise<string> =>
      JSON.stringify({
        overlap: true,
        note: 'README preamble lists C#; PLAN omits it',
        sections: [
          { side: 'A', heading: null },
          { side: 'B', heading: 'Tech Stack' },
        ],
      });
    const out = await flagOverlaps(repo, [area('core/languages', ['README.md', 'docs/PLAN.md'])], docs, { transport });
    const sections = out.get('core/languages')?.[0].sections;
    expect(sections).toContainEqual({ doc: 'README.md', heading: null });
    expect(sections).toContainEqual({ doc: 'docs/PLAN.md', heading: 'Tech Stack' });
  });

  it('does not flag complementary docs', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async () => ({ overlap: false, note: '' });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.size).toBe(0);
  });

  it('skips a pair a global relation already resolves', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const relations: Relation[] = [{ type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'filename' }];
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
      relations,
    });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });

  it('honors relation scope — a scoped relation only resolves its own area', async () => {
    const relations: Relation[] = [
      { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/auth' },
    ];
    const areas = [area('core/auth', ['a.md', 'b.md']), area('core/users-entity', ['a.md', 'b.md'])];
    const out = await flagOverlaps(repo, areas, [doc('a.md'), doc('b.md')], { runner: flagAll, relations });
    expect(out.has('core/auth')).toBe(false); // resolved here
    expect(out.has('core/users-entity')).toBe(true); // still flagged elsewhere
  });

  it('dedups the same disagreement flagged across shared areas', async () => {
    // One doc pair co-occurs in two areas and the runner flags it in both with
    // identical sections — one real disagreement. It collapses to the
    // lexicographically-first area so the user sees a single conflict.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('booking/appointments', ['a.md', 'b.md']), area('booking/auth', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'cancellation window differs',
      sections: [
        { doc: a.path, heading: 'Core domain' },
        { doc: b.path, heading: 'Key flows' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('booking/appointments')).toBe(true); // first area keeps it
    expect(out.has('booking/auth')).toBe(false); // duplicate dropped
    expect(out.get('booking/appointments')).toHaveLength(1);
  });

  it('dedups the taskline shape — a shared pointer on ONE side, different pointers on the other', async () => {
    // The live bug: README + SPEC's `rm` dispute flagged in two shared areas. The
    // SPEC side points at the SAME heading in both; the README side differs (a
    // heading in one area, the preamble/null in the other). A shared pointer on
    // ONE side is enough — one dispute, one record, spanning both areas.
    const docs = [doc('README.md'), doc('docs/SPEC.md')];
    const areas = [
      area('core/persistence', ['README.md', 'docs/SPEC.md']),
      area('core/tasks-entity', ['README.md', 'docs/SPEC.md']),
    ];
    const runner: OverlapRunner = async ({ areaId, a, b }) => ({
      overlap: true,
      note: `rm dispute (${areaId})`,
      sections: [
        { doc: a.path, heading: areaId === 'core/persistence' ? 'taskline' : null },
        { doc: b.path, heading: 'rm <id>' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    // One record, under the representative (fewest-null) area = persistence.
    expect(out.get('core/persistence')).toHaveLength(1);
    expect(out.has('core/tasks-entity')).toBe(false);
    // It records the full span so a resolution scoped to either area clears it.
    expect(out.get('core/persistence')![0].areas).toEqual(['core/persistence', 'core/tasks-entity']);
    // The surviving record is the more bandable side (a named README heading, no null).
    expect(out.get('core/persistence')![0].sections).toContainEqual({ doc: 'README.md', heading: 'taskline' });
  });

  it('keeps distinct conflicts between the same pair (different sections)', async () => {
    // The same pair disagrees on DIFFERENT sections in each area — two genuinely
    // different disagreements, so neither is deduped away.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('svc/x', ['a.md', 'b.md']), area('svc/y', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ areaId, a }) => ({
      overlap: true,
      note: `differs in ${areaId}`,
      sections: [{ doc: a.path, heading: areaId === 'svc/x' ? 'Auth' : 'Billing' }],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('svc/x')).toBe(true);
    expect(out.has('svc/y')).toBe(true);
  });

  it('caps pairs per area and reports the cap', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')]; // 3 pairs
    const capped: Array<[string, number, number]> = [];
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md', 'c.md'])], docs, {
      runner,
      maxPairsPerArea: 2,
      onCapped: (areaId, examined, total) => capped.push([areaId, examined, total]),
    });
    expect(capped).toEqual([['core/auth', 2, 3]]);
    expect(calls).toBe(2);
  });

  it('caches verdicts per pair', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('core/auth', ['a.md', 'b.md'])];
    await flagOverlaps(repo, areas, docs, { runner });
    await flagOverlaps(repo, areas, docs, { runner });
    expect(calls).toBe(1);
  });

  it('does nothing when disabled', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
      enabled: false,
    });
    expect(out.size).toBe(0);
    expect(calls).toBe(0);
  });

  it('ignores single-doc areas (no pairs)', async () => {
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md'])], [doc('a.md')], { runner: flagAll });
    expect(out.size).toBe(0);
  });
});

// Realistic fixtures: a broad platform PRD whose sections each state real
// behavior, and a focused pagination standard note. The tagger (upstream) files
// them under different concerns, so they never share an area — heading widening
// is what re-couples the pagination sections so the overlap judge sees the pair.
const BROAD_PRD = `# Payments Platform PRD
Status: shipped

## Authentication
All endpoints require a Bearer JWT in the Authorization header.

## Errors
Errors use the standard envelope { code, message, details }.

## Pagination
List endpoints use offset/limit paging with a default page size of 25.

## Idempotency
Write endpoints accept an Idempotency-Key header, retained for 24h.
`;

const PAGINATION_NOTE = `# Pagination Standard

## Pagination
All list endpoints MUST use cursor-based pagination with a default page size of 50.
`;

describe('flagOverlaps — heading-widened cross-area candidates', () => {
  it('pairs an outside doc whose heading matches the area concern with the area docs', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const seen: Array<[string, string, string]> = [];
    const runner: OverlapRunner = async ({ areaId, a, b }) => {
      seen.push([areaId, a.path, b.path]);
      return { overlap: true, note: `${a.path} vs ${b.path}` };
    };
    // PRD tagged api-conventions (umbrella), note tagged pagination — they never
    // co-locate. Neither area has two docs, so only widening can produce a pair.
    const areas = [
      area('core/api-conventions', ['docs/platform-prd.md']),
      area('core/pagination', ['docs/pagination.md']),
    ];
    const out = await flagOverlaps(repo, areas, [prd, note], { runner });

    // Exactly one widened pair, examined under the pagination area.
    expect(seen).toEqual([['core/pagination', 'docs/platform-prd.md', 'docs/pagination.md']]);
    expect(out.get('core/pagination')).toEqual([
      {
        docs: ['docs/platform-prd.md', 'docs/pagination.md'],
        note: 'docs/platform-prd.md vs docs/pagination.md',
        sections: [],
        areas: ['core/pagination'],
      },
    ]);
    // The umbrella area itself has no matching outside heading → no pair.
    expect(out.has('core/api-conventions')).toBe(false);
  });

  it('folds heading synonyms through the alias map (an "Authentication" heading matches the auth concern)', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD); // carries a "## Authentication" heading
    const authAdr = doc('docs/auth-adr.md', '# Bearer JWT ADR\n\n## Auth\nWe use Bearer JWTs.\n');
    const seen: string[] = [];
    const runner: OverlapRunner = async ({ a, b }) => {
      seen.push([a.path, b.path].sort().join(' vs '));
      return { overlap: false, note: '' };
    };
    const areas = [area('core/auth', ['docs/auth-adr.md'])];
    await flagOverlaps(repo, areas, [prd, authAdr], { runner });
    // "Authentication" → auth via the alias map, so the PRD widens into core/auth.
    expect(seen).toEqual(['docs/auth-adr.md vs docs/platform-prd.md']);
  });

  it('skips a widened pair a relation already resolves', async () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const relations: Relation[] = [
      { type: 'keep-both', older: 'docs/pagination.md', newer: 'docs/platform-prd.md', detectedFrom: 'manual' },
    ];
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [prd, note], {
      runner,
      relations,
    });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });

  it('counts widened pairs against the per-area cap', async () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const prd1 = doc('docs/prd-1.md', BROAD_PRD);
    const prd2 = doc('docs/prd-2.md', BROAD_PRD);
    const capped: Array<[string, number, number]> = [];
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, prd1, prd2], {
      runner,
      maxPairsPerArea: 1,
      onCapped: (areaId, examined, total) => capped.push([areaId, examined, total]),
    });
    // Two widened pairs (prd-1,note) + (prd-2,note) — capped to 1.
    expect(capped).toEqual([['core/pagination', 1, 2]]);
    expect(calls).toBe(1);
  });

  it('does not self-pair or double-count repeated matching headings', async () => {
    // Two "## Pagination" headings in one doc still yield ONE pair, and an in-area
    // doc is never widened against itself.
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const prd = doc(
      'docs/dupe.md',
      '# Dupe\n\n## Pagination\nCursor paging.\n\n## Pagination\nStill cursor paging.\n',
    );
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, prd], { runner });
    expect(calls).toBe(1);
    expect(out.get('core/pagination')).toHaveLength(1);
  });

  it('adds nothing when no outside heading matches the area concern', async () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const other = doc('docs/billing.md', '# Billing\n\n## Invoices\nMonthly invoices.\n');
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/pagination', ['docs/pagination.md'])], [note, other], { runner });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });

  it('excludes process areas from widening (generic section names are not behavior)', async () => {
    // "## Overview" appears in nearly every doc; a process area must not fan out
    // to every doc that merely has an Overview section.
    const vision = doc('docs/vision.md', '# Vision\n\n## Overview\nThe product vision.\n');
    const prd = doc('docs/prd.md', '# PRD\n\n## Overview\nWhat we build.\n\n## Pagination\nCursor paging.\n');
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('process/overview', ['docs/vision.md'])], [vision, prd], { runner });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });
});
