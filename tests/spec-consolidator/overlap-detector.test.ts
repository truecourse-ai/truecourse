/**
 * The RETIREMENT of the overlap candidate net's doc-level machinery. Two
 * generations are gone from this module: the one-shot pair-matrix detector
 * (`flagOverlaps` / the window matrix), and then the
 * heading-widened doc net (`hasConcernHeading` / `widenedOverlapDocs`) — the
 * collision pairing's canonical-heading key
 * (`deriveCollisionPairs` in `collision-pairing.ts`) does the same folding at
 * SECTION level, so the cross-concern re-coupling the widened net existed for
 * now arrives as concrete section pairs.
 *
 * The case below keeps the net's defining scenario alive against the successor:
 * a broad PRD's `## Pagination` filed under an umbrella concern, and a focused
 * pagination note filed under `core/pagination` — different areas, so only the
 * heading fold can produce the pair.
 */
import { describe, it, expect } from 'vitest';
import { deriveCollisionPairs } from '../../packages/spec-consolidator/src/index.js';
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content: string): DocCandidate {
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

describe('the widened net, re-pointed at the collision pairing', () => {
  it('couples same-topic sections across docs the tagger filed apart', () => {
    const prd = doc('docs/platform-prd.md', BROAD_PRD);
    const note = doc('docs/pagination.md', PAGINATION_NOTE);
    const pairs = deriveCollisionPairs([prd, note]);
    const hit = pairs.find((p) => p.keys.includes('heading:pagination'));
    expect(hit).toBeDefined();
    expect([hit!.a.doc, hit!.b.doc].sort()).toEqual(['docs/pagination.md', 'docs/platform-prd.md']);
    expect([hit!.a.heading, hit!.b.heading]).toEqual(['Pagination', 'Pagination']);
  });
});
