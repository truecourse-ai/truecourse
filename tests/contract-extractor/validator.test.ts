import { describe, it, expect } from 'vitest';
import { validateMerged } from '../../packages/contract-extractor/src/validator.js';
import type { MergedArtifact } from '../../packages/contract-extractor/src/merger.js';
import type { Fragment } from '../../packages/contract-extractor/src/types.js';

function fragment(kind: string, identity: string, tcSource: string): Fragment {
  return {
    kind,
    identity,
    tcSource,
    origin: { source: 'SPEC.md', section: 'S', lines: [1, 1] },
    obligationKeys: [],
  };
}

function merged(kind: string, identity: string, tcSource: string): MergedArtifact {
  return {
    kind,
    identity,
    winning: fragment(kind, identity, tcSource),
    winningRank: 0,
    overridden: [],
    sameRankConflicts: [],
  };
}

describe('contract extractor — validator (strict ohm parse)', () => {
  it('accepts well-formed artifacts', () => {
    const result = validateMerged([
      merged('Operation', 'GET /x', 'operation GET "/x" { response 200 }'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.artifactCount).toBe(1);
  });

  it('reports an unknown clause as a HARD parse issue, attributed to the artifact', () => {
    const result = validateMerged([
      // `responce` is a typo for `response` — the strict grammar rejects it.
      merged('Operation', 'GET /x', 'operation GET "/x" { responce 200 }'),
    ]);
    expect(result.ok).toBe(false);
    const hard = result.issues.filter((i) => i.severity === 'hard');
    expect(hard.length).toBeGreaterThan(0);
    const parseIssue = hard.find((i) => i.artifactKey === 'Operation:GET /x');
    expect(parseIssue).toBeDefined();
    expect(parseIssue!.message).toContain('parse error');
    // The offending source is echoed back so the user can debug it.
    expect(parseIssue!.tcSource).toContain('responce');
  });

  it('isolates a parse failure to the broken artifact while still validating the rest', () => {
    const result = validateMerged([
      merged('Operation', 'GET /good', 'operation GET "/good" { response 200 }'),
      merged('Operation', 'GET /bad', 'operation GET "/bad" { responce 200 }'),
    ]);
    expect(result.ok).toBe(false);
    const keys = result.issues.map((i) => i.artifactKey);
    expect(keys).toContain('Operation:GET /bad');
    expect(keys).not.toContain('Operation:GET /good');
    // The good artifact still made it into the resolver index.
    expect(result.artifactCount).toBe(1);
  });
});
