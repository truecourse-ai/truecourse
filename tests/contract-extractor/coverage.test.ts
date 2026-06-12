import { describe, it, expect } from 'vitest';
import {
  detectUncoveredClaims,
  fragmentCoversClaim,
  synthesizeObligationFragment,
} from '../../packages/contract-extractor/src/coverage.js';
import { mergeFragments } from '../../packages/contract-extractor/src/merger.js';
import type {
  Fragment,
  SpecSlice,
  SpecSliceClaim,
} from '../../packages/contract-extractor/src/types.js';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';

function frag(
  kind: string,
  identity: string,
  source: string,
  lines: [number, number],
): Fragment {
  return {
    kind,
    identity,
    tcSource: `${kind.toLowerCase()} ${identity} {}`,
    origin: { source, section: 'section', lines },
    obligationKeys: [],
  };
}

function claim(
  id: string,
  subject: string,
  file: string,
  line: number,
  extra: Partial<SpecSliceClaim> = {},
): SpecSliceClaim {
  return { id, subject, topic: 'data', file, line, ...extra };
}

function uncoveredIds(artifacts: ReturnType<typeof mergeFragments>['artifacts'], slice: SpecSlice) {
  return detectUncoveredClaims(artifacts, [slice])
    .map((u) => u.claim.id)
    .sort();
}

describe('claim-coverage detection', () => {
  // Mirrors the real cal.diy cancellation-reason round-trip: the enum, the
  // entity field, and the two edge-case obligations were emitted, but the
  // decisions.md decision, the display-label setting, and the data-flow
  // claim were silently dropped.
  const slice: SpecSlice = {
    id: 's1',
    specPath: '.truecourse/specs/claims.json#_shared/data',
    headingPath: ['_shared', 'data'],
    lineRange: [1, 80],
    text: 'rendered slice text',
    headingLevel: 1,
    claims: [
      claim('c-enum', 'CancellationReasonRequirement enum', 'design.md', 21),
      claim('c-entity', 'EventType / cancellation reason', 'design.md', 27),
      claim('c-edge', 'cancellation reason requirement / edge cases', 'design.md', 68),
      claim('c-decision', 'CancellationReasonRequirement field', 'decisions.md', 14),
      claim('c-display', 'Event Type / cancellation reason setting', 'design.md', 39),
      claim('c-dataflow', 'EventType / fields', 'design.md', 57),
    ],
  };

  const artifacts = mergeFragments([
    frag('Enum', 'CancellationReasonRequirement', 'design.md', [21, 31]),
    frag('Entity', 'EventType', 'design.md', [21, 33]),
    frag('UnenforceableObligation', 'cancellation-reason.platform-users', 'design.md', [68, 73]),
    frag('UnenforceableObligation', 'cancellation-reason.team-bookings', 'design.md', [68, 73]),
  ]).artifacts;

  it('flags exactly the dropped claims as uncovered', () => {
    expect(uncoveredIds(artifacts, slice)).toEqual(['c-dataflow', 'c-decision', 'c-display']);
  });

  it('counts a claim covered when an artifact origin overlaps its line', () => {
    // c-entity@27 is inside the entity origin range 21..33.
    const cov = artifacts.some((a) =>
      fragmentCoversClaim(a.winning, claim('c-entity', 'EventType / cancellation reason', 'design.md', 27)),
    );
    expect(cov).toBe(true);
  });

  it('treats a different source file as uncovered even on overlapping lines', () => {
    // decisions.md:14 overlaps the 21..33 range numerically, but the file
    // differs — must not be considered covered.
    const only = { ...slice, claims: [claim('c-decision', 'x', 'decisions.md', 14)] };
    expect(uncoveredIds(artifacts, only)).toEqual(['c-decision']);
  });

  it('covers a claim by identity match when lines do not overlap', () => {
    const op = mergeFragments([frag('Operation', 'POST /api/orders', 'other.md', [1, 2])]).artifacts;
    const s: SpecSlice = {
      ...slice,
      claims: [claim('c-op', 'POST /api/orders', 'spec.md', 999)],
    };
    expect(uncoveredIds(op, s)).toEqual([]);
  });

  it('is a no-op for slices without claims', () => {
    const noClaims: SpecSlice = { ...slice, claims: undefined };
    expect(detectUncoveredClaims(artifacts, [noClaims])).toEqual([]);
  });

  it('covers a claim via an additionalSources line', () => {
    const s: SpecSlice = {
      ...slice,
      claims: [
        claim('c-multi', 'multi-source', 'README.md', 5, {
          additionalSources: [{ file: 'design.md', line: 70 }],
        }),
      ],
    };
    expect(uncoveredIds(artifacts, s)).toEqual([]); // design.md:70 ∈ 68..73
  });
});

describe('synthesizeObligationFragment', () => {
  it('produces a valid, resolvable unenforceable-obligation', () => {
    const f = synthesizeObligationFragment(
      claim('c1', 'EventType / fields', 'design.md', 57),
    );
    expect(f.kind).toBe('UnenforceableObligation');
    expect(f.tcSource).toContain('unenforceable-obligation');
    expect(f.tcSource).toContain('category data');
    expect(f.tcSource).toContain('EventType / fields');

    // The synthesized .tc must parse + resolve without hard errors.
    const r = resolve([parseFile('synth.tc', f.tcSource)]);
    expect(r.errors).toEqual([]);
  });

  it('carries the claim topic through as the obligation category', () => {
    const overview = synthesizeObligationFragment(
      claim('c', 'Overview', 'design.md', 3, { topic: 'overview' }),
    );
    expect(overview.tcSource).toContain('category overview');
  });

  it('de-duplicates identities against the existing set', () => {
    const seen = new Set<string>();
    const a = synthesizeObligationFragment(claim('a', 'Same Subject', 'd.md', 1), seen);
    const b = synthesizeObligationFragment(claim('b', 'Same Subject', 'd.md', 2), seen);
    expect(a.identity).not.toBe(b.identity);
  });

  it('quotes a slashed source path for the parser', () => {
    const f = synthesizeObligationFragment(
      claim('c', 'Nested', 'docs/design.md', 4),
    );
    expect(f.tcSource).toContain('origin "docs/design.md"');
    const r = resolve([parseFile('synth.tc', f.tcSource)]);
    expect(r.errors).toEqual([]);
  });
});
