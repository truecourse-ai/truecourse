import { describe, it, expect } from 'vitest';
import { claimWordsByDoc, composeClaimCoverage } from '../../packages/core/src/commands/guard-read';
import { composeBlockedOnReason } from '../../packages/shared/src/guard/report';
import { claimId, sentenceKey } from '../../packages/shared/src/index';
import type {
  Claim,
  ClaimsFile,
  GuardCoverageStatus,
  GuardFlowsFile,
  GuardGenerateReport,
  GuardLatest,
  GuardManifest,
} from '../../packages/shared/src/index';

/**
 * The claim-keyed coverage join: every claim of the corpus wears the worst word
 * over the flows that carry it, a claim no flow carries wears what the corpus's
 * no-flow record says about it, and a dismissed claim wears the ruling.
 */

const DOC = 'docs/spec.md';

const claimOf = (statement: string, testable: Claim['testable'] = true): Claim => {
  const sentences = [sentenceKey(`It ${statement}.`)];
  return { id: claimId(DOC, sentences), doc: DOC, sentences, subject: 'spec', statement, areas: [], testable };
};

/** One flow per claim, each with the given manifest scenario status and run outcome. */
const CASES = [
  { title: 'passes', scenario: 'passing', outcome: 'pass' },
  { title: 'fails', scenario: 'passing', outcome: 'fail' },
  { title: 'errors', scenario: 'passing', outcome: 'error' },
  { title: 'went stale', scenario: 'passing', outcome: 'stale' },
  { title: 'was guarded earlier', scenario: 'passing', outcome: null },
  { title: 'never ran', scenario: 'never-run', outcome: null },
] as const;

const claims: ClaimsFile = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  claims: [
    ...CASES.map((c) => claimOf(c.title)),
    claimOf('is blocked on an interface'),
    claimOf('is not observable'),
    claimOf('nothing accounts for'),
    claimOf('was dismissed'),
    claimOf('awaits authoring'),
    claimOf('is the heart of the product', { reason: 'not-observable' }),
  ],
};
const byTitle = (title: string) => claims.claims.find((c) => c.statement === title)!;

const flowOf = (title: string) => ({
  id: `flow-${byTitle(title).id}`,
  title: `A user ${title}`,
  goal: title,
  fingerprint: `sha256:${title}`,
  milestones: [{ order: 1, doc: DOC, claimId: byTitle(title).id, claimTitle: title, sentences: byTitle(title).sentences }],
  bindings: [{ doc: DOC, sentences: byTitle(title).sentences }],
  composedOf: [],
  synthesisInputsHash: 'sha256:i',
});

const flows: GuardFlowsFile = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  flows: [...CASES.map((c) => flowOf(c.title)), flowOf('awaits authoring')],
  noFlowClaims: [
    { claimId: byTitle('is blocked on an interface').id, reason: 'no `cli/spec` interface has been derived.' },
    { claimId: byTitle('is not observable').id, reason: 'unobservable via CLI — nothing prints it.' },
  ],
};

const manifest = {
  version: 1,
  flows: CASES.map((c) => ({
    flowId: flowOf(c.title).id,
    flowFingerprint: flowOf(c.title).fingerprint,
    bindings: flowOf(c.title).bindings,
    scenarios: [{ id: `${flowOf(c.title).id}.cli.1`, drivers: ['cli'], status: c.scenario }],
    interfaces: [],
    generationInputsHash: null,
    gaps: [],
  })),
} as unknown as GuardManifest;

const latest = {
  run: { runId: 'r1', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r' },
  summary: { total: 4, pass: 1, fail: 1, stale: 1, orphaned: 0, error: 1 },
  scenarios: CASES.filter((c) => c.outcome).map((c) => ({
    id: `${flowOf(c.title).id}.cli.1`,
    title: c.title,
    binds: { doc: DOC, sentences: byTitle(c.title).sentences },
    outcome: c.outcome,
    durationMs: 1,
    ...(c.outcome === 'fail' ? { failure: { step: 1, expected: 'x', actual: 'y' }, evidencePath: '.truecourse/guard/evidence/r1/f' } : {}),
  })),
} as unknown as GuardLatest;

const result = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  status: 'ok',
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  // The flow carrying "awaits authoring" could not be authored: no scenario, no gap.
  errors: [
    { doc: DOC, kind: 'authoring', flowId: flowOf('awaits authoring').id, surface: 'cli', message: 'authoring (cli) call failed' },
  ],
  extractionFailures: [],
} as unknown as GuardGenerateReport;

const decisions = {
  version: 1 as const,
  dismissedClaims: [{ claimId: byTitle('was dismissed').id, dismissedAt: '2026-08-07T00:00:00.000Z', note: 'repo hygiene, not product' }],
  dismissedFlows: [],
};

describe('composeClaimCoverage — every status, keyed by the claim', () => {
  const view = composeClaimCoverage({ manifest, latest, result, flows, claims, decisions });
  const status = (title: string): GuardCoverageStatus | undefined => view.claims.find((c) => c.id === byTitle(title).id)?.status;
  const row = (title: string) => view.claims.find((c) => c.id === byTitle(title).id)!;

  it('wears the run outcome of the flow that carries it', () => {
    expect(status('passes')).toBe('pass');
    expect(status('fails')).toBe('fail');
    expect(status('errors')).toBe('error');
    expect(status('went stale')).toBe('stale');
  });

  it('wears the birth status when no run covers the flow', () => {
    expect(status('was guarded earlier')).toBe('guarded');
    expect(status('never ran')).toBe('never-run');
  });

  it('wears the kind the no-flow record states, with its reason', () => {
    expect(row('is blocked on an interface')).toMatchObject({ status: 'no-interface', flows: [] });
    expect(row('is blocked on an interface').reason).toContain('cli/spec');
    expect(row('is not observable')).toMatchObject({ status: 'untestable', flows: [] });
  });

  it('is unguarded when nothing accounts for it', () => {
    expect(row('nothing accounts for')).toMatchObject({ status: 'unguarded', flows: [] });
    expect(row('nothing accounts for').reason).toBeUndefined();
  });

  it('wears the ruling when dismissed, whatever else says', () => {
    expect(row('was dismissed')).toMatchObject({ status: 'dismissed', dismissed: true, reason: 'repo hygiene, not product' });
  });

  // "Generate tried and could not" is NOT "nothing was ever tried".
  it('paints a claim whose flow only errored at authoring as authoring-error', () => {
    const r = row('awaits authoring');
    expect(r.status).toBe('authoring-error');
    expect(r.flows.map((f) => f.flowId)).toEqual([flowOf('awaits authoring').id]);
    expect(r.flows[0].surfaces).toEqual([{ surface: 'cli', status: 'authoring-error' }]);
  });

  it('lists each carrying flow as the Flows page words it, with the milestones proving the claim', () => {
    const r = row('fails');
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]).toMatchObject({
      flowId: flowOf('fails').id,
      title: 'A user fails',
      status: 'fail',
      epic: false,
      manual: false,
      milestoneOrders: [1],
      milestoneCount: 1,
    });
  });

  it('tallies the five words over every claim, dismissed ones under Not testable', () => {
    expect(view.totals).toEqual({
      claims: 11,
      byStatus: { failed: 2, blocked: 4, 'never-run': 1, 'partially-succeeded': 0, succeeded: 2, 'not-testable': 2 },
      dismissed: 1,
      untestable: 1,
    });
    const heart = byTitle('is the heart of the product');
    expect(view.untestable).toEqual([{ id: heart.id, doc: DOC, statement: heart.statement, reason: 'not-observable' }]);
  });

  it('folds the claims per document: the document wears its worst word', () => {
    const words = claimWordsByDoc(view);
    expect([...words.keys()]).toEqual([DOC]);
    expect(words.get(DOC)!.doc).toBe('failed');
    expect(words.get(DOC)!.claims.size).toBe(11);
    expect(words.get(DOC)!.blockedReasons).toEqual(expect.arrayContaining([expect.stringContaining('cli/spec')]));
  });

  it('is the empty view without a claim corpus', () => {
    const empty = composeClaimCoverage({ manifest: null, latest: null, result: null });
    expect(empty.extracted).toBe(false);
    expect(empty.claims).toEqual([]);
    expect(empty.totals.claims).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The needs-setup promotion, entirely inside the read model: a flow blocked on
// a providable service lifts its claim to `needs-setup`.
// ---------------------------------------------------------------------------

describe('composeClaimCoverage — needs-setup', () => {
  const blockedManifest = {
    version: 1,
    flows: ['passes', 'fails', 'errors'].map((title) => ({
      flowId: flowOf(title).id,
      flowFingerprint: flowOf(title).fingerprint,
      bindings: flowOf(title).bindings,
      scenarios: [],
      interfaces: [],
      generationInputsHash: null,
      gaps: [
        {
          surface: 'cli',
          kind: 'blocked-on',
          reason: composeBlockedOnReason(
            [title === 'passes' ? 'open-meteo' : title === 'fails' ? 'stripe' : 'external-service'],
            'it calls something out there',
          ),
        },
      ],
    })),
  } as unknown as GuardManifest;
  const compose = (externals: Record<string, 'provided' | 'incomplete' | 'unprovided'> | null) =>
    composeClaimCoverage({ manifest: blockedManifest, latest: null, result: null, flows, claims, externals });

  const joined = compose({ 'open-meteo': 'unprovided', stripe: 'provided' });
  const row = (title: string) => joined.claims.find((c) => c.id === byTitle(title).id)!;

  it('promotes a gap naming a KNOWN, unprovided service — and says which', () => {
    expect(row('passes').status).toBe('needs-setup');
    expect(row('passes').needsSetup).toEqual({ services: ['open-meteo'], provided: [] });
  });

  it('a PROVIDED service is the re-generate sub-state, not a to-do', () => {
    expect(row('fails').status).toBe('needs-setup');
    expect(row('fails').needsSetup).toEqual({ services: [], provided: ['stripe'] });
  });

  it('a GENERIC noun stays plain blocked-on', () => {
    expect(row('errors').status).toBe('blocked-on');
    expect(row('errors').needsSetup).toBeUndefined();
  });

  it('without externals data EVERY claim stays plain blocked-on', () => {
    for (const externals of [null, {}]) {
      const plain = compose(externals);
      const statuses = ['passes', 'fails', 'errors'].map((t) => plain.claims.find((c) => c.id === byTitle(t).id)!.status);
      expect(statuses).toEqual(['blocked-on', 'blocked-on', 'blocked-on']);
    }
  });
});
