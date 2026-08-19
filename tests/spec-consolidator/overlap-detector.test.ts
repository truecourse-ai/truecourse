/**
 * The OVERLAP CANDIDATE NET — what survived the retirement of the pair-matrix
 * detector (plan 02 step 5). `flagOverlaps` / `buildOverlapUserPrompt` / the
 * window matrix were the ONE-SHOT stage's machinery and are gone: one
 * `spec-scan.overlap` session per AREA now reads the area's docs itself and both
 * flags and adjudicates (see `tests/core/spec-scan-overlap.test.ts`).
 *
 * What was never a call is what remains, and it still feeds the session's
 * briefing verbatim: `hasConcernHeading` / `widenedOverlapDocs`. The tagger
 * labels each doc independently, so the same subject lands under different
 * concerns across docs (a broad PRD's `## Pagination` tagged
 * `core/api-conventions`, a focused note tagged `core/pagination`) and the pair
 * would never share an area. The widened net re-couples them.
 *
 * The cases below are the widening half of the retired suite, re-pointed at the
 * deterministic functions; the rest of that suite (per-pair caching, the call
 * matrix, the prompt's closed heading choice-set, window splitting and verdict
 * aggregation) pinned behavior that no longer exists in any form.
 */
import { describe, it, expect } from 'vitest';
import {
  hasConcernHeading,
  widenedOverlapDocs,
} from '../../packages/spec-consolidator/src/index.js';
import type { Area, DocCandidate, VocabMap } from '../../packages/spec-consolidator/src/index.js';

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

// Realistic fixtures: a broad platform PRD whose sections each state real
// behavior, and a focused pagination standard note. The tagger (upstream) files
// them under different concerns, so they never share an area — heading widening
// is what re-couples the pagination sections so one area's session sees the pair.
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

describe('hasConcernHeading', () => {
  it('matches a heading that canonicalizes to the concern', () => {
    expect(hasConcernHeading(doc('docs/platform-prd.md', BROAD_PRD), 'pagination')).toBe(true);
  });

  it('folds heading synonyms through the alias map ("Authentication" → the auth concern)', () => {
    expect(hasConcernHeading(doc('docs/platform-prd.md', BROAD_PRD), 'auth')).toBe(true);
  });

  it('strips inline emphasis and code markers before matching', () => {
    const styled = doc('docs/styled.md', '# Styled\n\n## `Pagination` ##\nCursor paging.\n');
    expect(hasConcernHeading(styled, 'pagination')).toBe(true);
  });

  it('is false when no heading names the concern', () => {
    expect(hasConcernHeading(doc('docs/billing.md', '# Billing\n\n## Invoices\nMonthly.\n'), 'pagination')).toBe(
      false,
    );
  });

  it('honors a vocab map that merges a synonym onto the canonical concern', () => {
    const vocab: VocabMap = { products: {}, concerns: { paging: 'pagination' } };
    const d = doc('docs/paging.md', '# Paging\n\n## Paging\nCursor paging.\n');
    expect(hasConcernHeading(d, 'pagination')).toBe(false);
    expect(hasConcernHeading(d, 'pagination', vocab)).toBe(true);
  });
});

describe('widenedOverlapDocs — heading-widened cross-area candidates', () => {
  it('widens an outside doc whose heading matches the area concern', () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    // PRD tagged api-conventions (umbrella), note tagged pagination — they never
    // co-locate. Neither area has two docs, so only widening can produce a pair.
    const widened = widenedOverlapDocs(area('core/pagination', ['docs/pagination.md']), [prd, note]);
    expect(widened.map((d) => d.path)).toEqual(['docs/platform-prd.md']);
    // The umbrella area itself has no matching outside heading → nothing widens in.
    expect(
      widenedOverlapDocs(area('core/api-conventions', ['docs/platform-prd.md']), [prd, note]).map((d) => d.path),
    ).toEqual([]);
  });

  it('folds heading synonyms through the alias map (an "Authentication" heading widens into core/auth)', () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD); // carries a "## Authentication" heading
    const authAdr = doc('docs/auth-adr.md', '# Bearer JWT ADR\n\n## Auth\nWe use Bearer JWTs.\n');
    const widened = widenedOverlapDocs(area('core/auth', ['docs/auth-adr.md']), [prd, authAdr]);
    expect(widened.map((d) => d.path)).toEqual(['docs/platform-prd.md']);
  });

  it('widens EVERY matching outsider — nothing is capped or dropped', () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const prd1 = doc('docs/prd-1.md', BROAD_PRD);
    const prd2 = doc('docs/prd-2.md', BROAD_PRD);
    const widened = widenedOverlapDocs(area('core/pagination', ['docs/pagination.md']), [note, prd1, prd2]);
    expect(widened.map((d) => d.path)).toEqual(['docs/prd-1.md', 'docs/prd-2.md']);
  });

  it('never self-pairs, and a repeated matching heading still widens the doc once', () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const dupe = doc(
      'docs/dupe.md',
      '# Dupe\n\n## Pagination\nCursor paging.\n\n## Pagination\nStill cursor paging.\n',
    );
    const widened = widenedOverlapDocs(area('core/pagination', ['docs/pagination.md']), [note, dupe]);
    // The in-area doc is excluded (its own `## Pagination` never widens it into
    // its own area), and the twice-matching outsider appears exactly once.
    expect(widened.map((d) => d.path)).toEqual(['docs/dupe.md']);
  });

  it('adds nothing when no outside heading matches the area concern', () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const other = doc('docs/billing.md', '# Billing\n\n## Invoices\nMonthly invoices.\n');
    expect(widenedOverlapDocs(area('core/pagination', ['docs/pagination.md']), [note, other])).toEqual([]);
  });

  it('excludes process areas from widening (generic section names are not behavior)', () => {
    // "## Overview" appears in nearly every doc; a process area must not fan out
    // to every doc that merely has an Overview section.
    const vision = doc('docs/vision.md', '# Vision\n\n## Overview\nThe product vision.\n');
    const prd = doc('docs/prd.md', '# PRD\n\n## Overview\nWhat we build.\n\n## Pagination\nCursor paging.\n');
    expect(widenedOverlapDocs(area('process/overview', ['docs/vision.md']), [vision, prd])).toEqual([]);
  });

  it('keeps discovery order, so a briefing built from it is deterministic', () => {
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const a = doc('docs/z-prd.md', BROAD_PRD);
    const b = doc('docs/a-prd.md', BROAD_PRD);
    expect(
      widenedOverlapDocs(area('core/pagination', ['docs/pagination.md']), [note, a, b]).map((d) => d.path),
    ).toEqual(['docs/z-prd.md', 'docs/a-prd.md']);
  });
});
