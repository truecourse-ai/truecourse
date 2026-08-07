import { describe, it, expect } from 'vitest';
import { composeDocCoverage } from '../../packages/core/src/commands/guard-read';
import { claimContentHash } from '../../packages/shared/src/guard/claims';
import type {
  GuardClaimsFile,
  GuardFlowsFile,
  GuardGenerateReport,
  GuardLatest,
  GuardManifest,
} from '../../packages/shared/src/index';

const DOC = 'docs/spec.md';
// A frontmatter-titled doc: the lead is now a bindable section of its own.
const CONTENT = [
  '---',
  'title: "Rule coverage"',
  '---',
  '',
  'TrueCourse ships deterministic rules and LLM rules.',
  '',
  '## Counting',
  'The counts drift with every rule added.',
].join('\n');

const CLAIM_TITLE = 'ships 1,500+ deterministic rules and 100 LLM rules';
const GAP_REASON = 'unobservable via CLI — `rules list` carries no deterministic-vs-LLM label.';

const claim = (title: string, anchor: string) => {
  const body = { doc: DOC, anchor, title, claim: `${title}.` };
  return { id: title.replace(/\W+/g, '-').toLowerCase(), ...body, contentHash: claimContentHash(body), needs: [] };
};

const claims: GuardClaimsFile = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  claims: [claim(CLAIM_TITLE, 'rule-coverage'), claim('the counts drift', 'counting')],
  untestable: [],
};

const flows: GuardFlowsFile = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  flows: [
    {
      id: 'read-the-rule-coverage',
      title: 'A developer reads the rule coverage',
      goal: 'Read the rule coverage',
      fingerprint: 'sha256:f',
      milestones: [{ order: 1, doc: DOC, anchor: 'rule-coverage', claimTitle: 'the counts drift' }],
      bindings: [{ doc: DOC, anchor: 'rule-coverage', fingerprint: 'sha256:s' }],
      composedOf: [],
      synthesisInputsHash: 'sha256:i',
    },
  ],
  noFlowClaims: [{ doc: DOC, anchor: 'rule-coverage', claimTitle: CLAIM_TITLE, reason: GAP_REASON }],
};

const manifest: GuardManifest = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  recipeFingerprint: 'sha256:r',
  flows: [
    {
      flowId: 'read-the-rule-coverage',
      flowFingerprint: 'sha256:f',
      bindings: [{ doc: DOC, anchor: 'rule-coverage', fingerprint: 'sha256:s' }],
      scenarios: [{ id: 'read-the-rule-coverage.cli.1', surface: 'cli', status: 'passing' }],
      journeys: [],
      gaps: [],
    },
  ],
} as unknown as GuardManifest;

const latest = null as unknown as GuardLatest | null;

// The last generate restates the same gap as a claim-level coverage gap, with the
// claim's title folded into its reason — the shape generate writes.
const result = {
  generatedAt: '2026-08-07T00:00:00.000Z',
  coverageGaps: [
    { doc: DOC, anchor: 'rule-coverage', kind: 'untestable', reason: `${CLAIM_TITLE} — ${GAP_REASON}` },
    { doc: DOC, anchor: 'counting', kind: 'no-claim', reason: 'the section states no testable behaviour' },
  ],
} as unknown as GuardGenerateReport;

const compose = (over: Parameters<typeof composeDocCoverage>[2] = {} as never) =>
  composeDocCoverage(DOC, CONTENT, { manifest, latest, result, flows, claims, ...over });

describe('composeDocCoverage — claim-level gaps stay visible', () => {
  it('binds the frontmatter lead as a section of its own', () => {
    expect(compose().sections.map((s) => s.anchor)).toEqual(['rule-coverage', 'counting']);
  });

  it('shows a guarded section its gapped claims, which its RANK cannot carry', () => {
    const lead = compose().sections[0];
    // The section outranks its gaps — that is exactly the case the gaps used to vanish in.
    expect(lead.status).not.toBe('untestable');
    expect(lead.flows).toHaveLength(1);
    expect(lead.claimGaps).toHaveLength(1);
    expect(lead.claimGaps[0]).toMatchObject({ title: CLAIM_TITLE, reason: GAP_REASON });
  });

  it('resolves each gapped claim to its store id, so the row can link to the claim', () => {
    expect(compose().sections[0].claimGaps[0].claimId).toBe(claims.claims[0].id);
  });

  it('merges the generate gap with the no-flow claim instead of double-counting it', () => {
    // Both records state the same gap: the generate reason CONTAINS the corpus reason.
    expect(compose().sections[0].claimGaps.map((g) => g.reason)).toEqual([GAP_REASON]);
  });

  it('keeps a generate gap the flow corpus does not restate, with its kind', () => {
    const counting = compose().sections[1];
    expect(counting.claimGaps).toHaveLength(1);
    expect(counting.claimGaps[0]).toMatchObject({
      kind: 'no-claim',
      reason: 'the section states no testable behaviour',
    });
    expect(counting.claimGaps[0].title).toBeUndefined();
  });

  it('still lists the gaps without a claims store, just unlinked', () => {
    const lead = compose({ manifest, latest, result, flows, claims: null }).sections[0];
    expect(lead.claimGaps).toHaveLength(1);
    expect(lead.claimGaps[0].claimId).toBeUndefined();
    expect(lead.claimGaps[0].title).toBe(CLAIM_TITLE);
  });

  it('is an empty list for a section nothing gapped', () => {
    const noGaps = composeDocCoverage(DOC, CONTENT, { manifest, latest, result: null, flows: null, claims });
    expect(noGaps.sections.every((s) => s.claimGaps.length === 0)).toBe(true);
  });
});

describe('composeDocCoverage — the gap merge is tight, never greedy', () => {
  it('keeps a distinct gap whose reason merely CONTAINS the no-flow reason mid-sentence', () => {
    const shortReason = 'not observable';
    const flowsShort: GuardFlowsFile = {
      ...flows,
      noFlowClaims: [{ doc: DOC, anchor: 'rule-coverage', claimTitle: CLAIM_TITLE, reason: shortReason }],
    };
    const distinct = {
      generatedAt: '2026-08-07T00:00:00.000Z',
      coverageGaps: [
        { doc: DOC, anchor: 'rule-coverage', kind: 'untestable', reason: `${shortReason} without a TTY, so the run stops` },
      ],
    } as unknown as GuardGenerateReport;
    const lead = composeDocCoverage(DOC, CONTENT, {
      manifest,
      latest,
      result: distinct,
      flows: flowsShort,
      claims,
    }).sections[0];
    expect(lead.claimGaps.map((g) => g.reason)).toEqual([
      shortReason,
      `${shortReason} without a TTY, so the run stops`,
    ]);
  });
});
