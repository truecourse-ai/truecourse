/**
 * `carryForwardBirthFindings` — the SPLIT durability contract. A COMMITTED
 * failing test's record is its manifest `diagnosis` (part of the same commit as
 * the red test), so its report row RE-DERIVES from the manifest and never rides
 * the prior report; the prior-report carry NARROWS to the withheld classes (a
 * `generation-defect` failure, a `fidelity` rejection), which have no committed
 * record anywhere else. The motivating loss stays covered: a cached no-op
 * regenerate must never blank a red test's detail while the manifest says
 * `failing` (the cal.com bench loss).
 */
import { describe, it, expect } from 'vitest';
import {
  carryForwardBirthFindings,
  type GuardBirthFinding,
  type GuardGenerateReport,
  type GuardManifest,
  type GuardManifestScenario,
  type GuardScenarioDiagnosis,
} from '../../packages/shared/src/index';

function report(overrides: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-07-30T12:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 0,
    skippedUnchanged: 1,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...overrides,
  };
}

function diagnosis(overrides: Partial<GuardScenarioDiagnosis> = {}): GuardScenarioDiagnosis {
  return {
    doc: 'README.md',
    anchor: 'a/b',
    title: 'claim of the red test',
    step: 1,
    expected: 'status 200',
    actual: 'status 404',
    file: '.truecourse/scenarios/a/red.api.1.yaml',
    ...overrides,
  };
}

function finding(scenarioId: string, overrides: Partial<GuardBirthFinding> = {}): GuardBirthFinding {
  return {
    doc: 'README.md',
    anchor: 'a/b',
    scenarioId,
    title: `claim of ${scenarioId}`,
    step: 1,
    expected: 'status 200',
    actual: 'status 404',
    flowId: 'f1',
    surface: 'api',
    ...overrides,
  };
}

function manifestWith(
  scenarios: (Partial<GuardManifestScenario> & { id: string })[],
  flow: { generationInputsHash?: string | null; gaps?: { surface: string; kind: string; reason: string }[] } = {},
): GuardManifest {
  return {
    version: 3,
    flows: [
      {
        flowId: 'f1',
        flowFingerprint: 'sha256:f1',
        bindings: [{ doc: 'README.md', anchor: 'a/b', fingerprint: 'sha256:s1' }],
        scenarios: scenarios.map((s) => ({ surface: 'api' as const, status: 'passing' as const, ...s })),
        journeys: [],
        generationInputsHash: flow.generationInputsHash === undefined ? 'sha256:g1' : flow.generationInputsHash,
        gaps: flow.gaps ?? [],
      },
    ],
  } as unknown as GuardManifest;
}

describe('carryForwardBirthFindings — the committed class rides the manifest', () => {
  it('re-derives a committed failing row from the manifest diagnosis — no prior report needed', () => {
    const manifest = manifestWith([
      { id: 'red.api.1', status: 'failing', diagnosis: diagnosis({ triage: { verdict: 'code-drift', confidence: 'high', brief: 'b', recommendation: 'r' } }) },
      { id: 'green.api.1', status: 'passing' },
    ]);
    const merged = carryForwardBirthFindings(report(), null, manifest);
    expect(merged.birthFindings).toHaveLength(1);
    expect(merged.birthFindings[0]).toMatchObject({
      scenarioId: 'red.api.1',
      committed: true,
      flowId: 'f1',
      surface: 'api',
      file: '.truecourse/scenarios/a/red.api.1.yaml',
      expected: 'status 200',
      actual: 'status 404',
      triage: { verdict: 'code-drift' },
    });
  });

  it('a fresh finding or a rewrite supersedes the manifest row', () => {
    const manifest = manifestWith([
      { id: 'red.api.1', status: 'failing', diagnosis: diagnosis() },
      { id: 'rewritten.api.1', status: 'failing', diagnosis: diagnosis() },
    ]);
    const current = report({
      birthFindings: [finding('red.api.1', { committed: true, actual: 'fresh actual' })],
      written: [
        {
          id: 'rewritten.api.1',
          title: 't',
          doc: 'README.md',
          anchor: 'a/b',
          file: '.truecourse/scenarios/a/rewritten.api.1.yaml',
          status: 'passing',
        },
      ],
    });
    const merged = carryForwardBirthFindings(current, null, manifest);
    expect(merged.birthFindings.map((f) => [f.scenarioId, f.actual])).toEqual([
      ['red.api.1', 'fresh actual'],
    ]);
  });

  it('LEGACY: a failing scenario with no diagnosis still carries its prior-report row', () => {
    const manifest = manifestWith([
      { id: 'red.api.1', status: 'failing' },
      { id: 'now-passing.api.1', status: 'passing' },
    ]);
    const prior = report({
      birthFindings: [
        finding('red.api.1', { committed: true, actual: 'the recorded actual' }),
        finding('now-passing.api.1', { committed: true }),
        finding('deleted.api.1', { committed: true }),
      ],
    });
    const merged = carryForwardBirthFindings(report(), prior, manifest);
    expect(merged.birthFindings.map((f) => [f.scenarioId, f.actual])).toEqual([
      ['red.api.1', 'the recorded actual'],
    ]);
  });
});

describe('carryForwardBirthFindings — the withheld classes ride the prior report', () => {
  const genDefect = () =>
    finding('rejected.api.1', {
      triage: { verdict: 'generation-defect', confidence: 'medium', brief: 'b', recommendation: 'r' },
    });
  const fidelity = () => finding('weak.api.1', { kind: 'fidelity' });

  it('carries a withheld row while its flow is live, unsettled, and untouched this run', () => {
    const manifest = manifestWith([], { generationInputsHash: null });
    const merged = carryForwardBirthFindings(
      report(),
      report({ birthFindings: [genDefect(), fidelity()] }),
      manifest,
    );
    expect(merged.birthFindings.map((f) => f.scenarioId).sort()).toEqual([
      'rejected.api.1',
      'weak.api.1',
    ]);
  });

  it('a fresh outcome for the (flow, surface) supersedes it — finding, test, or gap', () => {
    const prior = report({ birthFindings: [genDefect()] });

    // Fresh finding for the same pair wins.
    const freshFinding = report({ birthFindings: [finding('other.api.1')] });
    expect(
      carryForwardBirthFindings(freshFinding, prior, manifestWith([], { generationInputsHash: null }))
        .birthFindings,
    ).toHaveLength(1);

    // A test written for the pair wins.
    const written = report({
      written: [
        {
          id: 'other.api.1',
          title: 't',
          doc: 'README.md',
          anchor: 'a/b',
          file: '.truecourse/scenarios/a/other.api.1.yaml',
          status: 'passing',
          flowId: 'f1',
          surface: 'api',
        },
      ],
    });
    expect(
      carryForwardBirthFindings(written, prior, manifestWith([], { generationInputsHash: null }))
        .birthFindings,
    ).toEqual([]);

    // A settled gap on the surface wins.
    expect(
      carryForwardBirthFindings(
        report(),
        prior,
        manifestWith([], {
          generationInputsHash: null,
          gaps: [{ surface: 'api', kind: 'blocked-on', reason: 'blocked on a credential: t' }],
        }),
      ).birthFindings,
    ).toEqual([]);
  });

  it('drops a withheld row when the flow settled or no longer exists', () => {
    const prior = report({ birthFindings: [genDefect()] });
    // Settled flow: every surface accounted for — the rejection is stale.
    expect(
      carryForwardBirthFindings(report(), prior, manifestWith([])).birthFindings,
    ).toEqual([]);
    // Flow gone from the manifest entirely.
    const gone = { version: 3, flows: [] } as unknown as GuardManifest;
    expect(carryForwardBirthFindings(report(), prior, gone).birthFindings).toEqual([]);
    // No manifest at all — nothing can be judged.
    expect(carryForwardBirthFindings(report(), prior, null).birthFindings).toEqual([]);
  });
});
