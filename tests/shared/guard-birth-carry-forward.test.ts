/**
 * `carryForwardBirthFindings` — a committed failing test's birth finding must
 * survive a generate that did not re-execute it (item 74). The motivating loss:
 * a cached no-op regenerate on the cal.com bench wrote `birthFindings: []` over
 * 39 recorded failures, and every red test's detail page went blank while the
 * manifest still said `failing`.
 */
import { describe, it, expect } from 'vitest';
import {
  carryForwardBirthFindings,
  type GuardBirthFinding,
  type GuardGenerateReport,
  type GuardManifest,
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

function finding(scenarioId: string, overrides: Partial<GuardBirthFinding> = {}): GuardBirthFinding {
  return {
    doc: 'README.md',
    anchor: 'a/b',
    scenarioId,
    committed: true,
    title: `claim of ${scenarioId}`,
    step: 1,
    expected: 'status 200',
    actual: 'status 404',
    ...overrides,
  };
}

function manifestWith(scenarios: { id: string; status: 'passing' | 'failing' }[]): GuardManifest {
  return {
    version: 3,
    flows: [
      {
        flowId: 'f1',
        flowFingerprint: 'sha256:f1',
        bindings: [{ doc: 'README.md', anchor: 'a/b', fingerprint: 'sha256:s1' }],
        scenarios: scenarios.map((s) => ({ id: s.id, surface: 'api' as const, status: s.status })),
        journeys: [],
        generationInputsHash: 'sha256:g1',
      },
    ],
  } as unknown as GuardManifest;
}

describe('carryForwardBirthFindings', () => {
  it('carries a prior finding whose test is still committed-failing and was not re-run', () => {
    const prior = report({ birthFindings: [finding('red.api.1')] });
    const merged = carryForwardBirthFindings(
      report(),
      prior,
      manifestWith([{ id: 'red.api.1', status: 'failing' }]),
    );
    expect(merged.birthFindings.map((f) => f.scenarioId)).toEqual(['red.api.1']);
  });

  it('fresh findings win, re-written scenarios and now-passing/gone tests drop out', () => {
    const prior = report({
      birthFindings: [
        finding('red.api.1', { actual: 'stale actual' }),
        finding('rewritten.api.1'),
        finding('now-passing.api.1'),
        finding('deleted.api.1'),
      ],
    });
    const current = report({
      birthFindings: [finding('red.api.1', { actual: 'fresh actual' })],
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
    const merged = carryForwardBirthFindings(
      current,
      prior,
      manifestWith([
        { id: 'red.api.1', status: 'failing' },
        { id: 'rewritten.api.1', status: 'failing' },
        { id: 'now-passing.api.1', status: 'passing' },
      ]),
    );
    expect(merged.birthFindings.map((f) => [f.scenarioId, f.actual])).toEqual([
      ['red.api.1', 'fresh actual'],
    ]);
  });

  it('never carries fidelity rejections, and no-ops without a prior report or manifest', () => {
    const prior = report({
      birthFindings: [finding('weak.api.1', { kind: 'fidelity', committed: false })],
    });
    const manifest = manifestWith([{ id: 'weak.api.1', status: 'failing' }]);
    expect(carryForwardBirthFindings(report(), prior, manifest).birthFindings).toEqual([]);
    expect(carryForwardBirthFindings(report(), null, manifest).birthFindings).toEqual([]);
    expect(carryForwardBirthFindings(report(), prior, null).birthFindings).toEqual([]);
  });
});
