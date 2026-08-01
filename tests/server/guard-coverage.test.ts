import { describe, it, expect } from 'vitest';
import { composeDocCoverage } from '../../packages/core/src/commands/guard-read';
import { composeBlockedOnReason } from '../../packages/shared/src/guard/report';
import type {
  GuardManifest,
  GuardLatest,
  GuardGenerateReport,
  GuardScenarioResult,
} from '../../packages/shared/src/index';

const DOC = 'docs/spec.md';

// A doc whose H1 siblings slugify to single-segment anchors (s-pass, s-fail, …),
// one per coverage status the join can produce on a LIVE section.
const CONTENT = [
  '# S Pass', 'a',
  '# S Fail', 'b',
  '# S Error', 'c',
  '# S Stale', 'd',
  '# S Guarded', 'e',
  '# S Api', 'f',
  '# S Web', 'g',
  '# S Tui', 'h',
  '# S Untestable', 'i',
  '# S No Claim', 'j',
  '# S Blocked', 'k',
  '# S Unguarded', 'l',
  '# S Moved', 'm',
  '# S Author Error', 'n',
].join('\n');

const fp = 'sha256:seed';
const binds = (section: string) => ({ doc: DOC, section, fingerprint: fp });

function scenario(over: Partial<GuardScenarioResult> & { id: string; section: string; outcome: GuardScenarioResult['outcome'] }): GuardScenarioResult {
  const { section, ...rest } = over;
  return { title: `t ${over.id}`, durationMs: 1, binds: binds(section), ...rest } as GuardScenarioResult;
}

const latest: GuardLatest = {
  run: { runId: 'r1', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r', scenarioFormat: 2 },
  summary: { total: 6, pass: 2, fail: 1, stale: 1, orphaned: 1, error: 1 },
  scenarios: [
    scenario({ id: 'sp', section: 's-pass', outcome: 'pass' }),
    scenario({ id: 'sf', section: 's-fail', outcome: 'fail', failure: { step: 1, expected: 'x', actual: 'y' }, evidencePath: '.truecourse/guard/evidence/r1/sf' }),
    scenario({ id: 'se', section: 's-error', outcome: 'error', failure: { step: 2, expected: 'p', actual: 'q' } }),
    scenario({ id: 'ss', section: 's-stale', outcome: 'stale', currentFingerprint: 'sha256:new' }),
    scenario({ id: 'sm', section: 's-old', outcome: 'pass', remappedTo: 's-moved' }),
    scenario({ id: 'so', section: 's-removed', outcome: 'orphaned' }),
  ],
  // The join reads `scenarios`, not the rollups (remap-correct), so leave empty.
  sections: [],
};

const manifest: GuardManifest = {
  version: 2,
  flows: [
    {
      flowId: `${DOC}#s-guarded`,
      flowFingerprint: fp,
      bindings: [{ doc: DOC, anchor: 's-guarded', fingerprint: fp }],
      scenarios: [{ id: 'sg1', surface: 'cli' }],
      generationInputsHash: null,
      gaps: [],
    },
  ],
};

const result: GuardGenerateReport = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 14,
  sectionsChanged: 0,
  skippedUnchanged: 14,
  noChanges: false,
  written: [],
  coverageGaps: [
    { doc: DOC, anchor: 's-api', kind: 'awaiting-driver', driver: 'library', reason: 'import-only surface' },
    { doc: DOC, anchor: 's-tui', kind: 'awaiting-driver', driver: 'tui', reason: 'terminal UI only' },
    { doc: DOC, anchor: 's-no-claim', kind: 'no-claim', reason: 'no assertable claim' },
    { doc: DOC, anchor: 's-blocked', kind: 'blocked-on', reason: composeBlockedOnReason(['git', 'db'], 'needs a git repo and a database') },
    { doc: DOC, anchor: 's-web', kind: 'awaiting-driver', driver: 'web', reason: 'browser-only' },
    { doc: DOC, anchor: 's-untestable', kind: 'untestable', reason: 'no CLI surface' },
  ],
  birthFindings: [],
  // The flow bound to `s-author-error` could not be authored: no scenario, no gap.
  errors: [
    {
      doc: DOC,
      anchor: 's-author-error',
      kind: 'authoring',
      flowId: 'author-error-flow',
      surface: 'cli',
      message: 'authoring (cli) call failed: claude timed out after 600000ms',
    },
    {
      doc: DOC,
      anchor: 's-author-error',
      kind: 'authoring',
      flowId: 'author-error-flow',
      surface: 'cli',
      message: 'authoring (cli) call failed: claude timed out after 600000ms',
    },
  ],
  extractionFailures: [],
  orphaned: [],
};

describe('composeDocCoverage — per-section join (all statuses)', () => {
  const cov = composeDocCoverage(DOC, CONTENT, { manifest, latest, result });
  const byAnchor = new Map(cov.sections.map((s) => [s.anchor, s]));
  const status = (a: string) => byAnchor.get(a)?.status;

  it('maps run outcomes from the last run onto live sections', () => {
    expect(status('s-pass')).toBe('pass');
    expect(status('s-fail')).toBe('fail');
    expect(status('s-error')).toBe('error');
    expect(status('s-stale')).toBe('stale');
  });

  it('carries failure detail + evidence pointer for a failed section', () => {
    const sf = byAnchor.get('s-fail')!;
    expect(sf.scenarios[0].failure).toEqual({ step: 1, expected: 'x', actual: 'y' });
    expect(sf.scenarios[0].evidencePath).toBe('.truecourse/guard/evidence/r1/sf');
    expect(sf.scenarioIds).toEqual(['sf']);
  });

  it('surfaces the edited fingerprint on a stale section', () => {
    expect(byAnchor.get('s-stale')!.scenarios[0].currentFingerprint).toBe('sha256:new');
  });

  it('marks a section with scenarios but no run outcome as guarded', () => {
    const sg = byAnchor.get('s-guarded')!;
    expect(sg.status).toBe('guarded');
    expect(sg.scenarioIds).toEqual(['sg1']);
  });

  it('maps coverage gaps (library / tui / no-claim) with their reasons', () => {
    expect(status('s-api')).toBe('library');
    expect(byAnchor.get('s-api')!.reason).toBe('import-only surface');
    expect(status('s-tui')).toBe('tui');
    expect(status('s-no-claim')).toBe('no-claim');
  });

  it('parses blocked-on capabilities from the gap reason', () => {
    const sb = byAnchor.get('s-blocked')!;
    expect(sb.status).toBe('blocked-on');
    expect(sb.blockedOnCapabilities).toEqual(['git', 'db']);
  });

  it('reads the awaiting-driver / untestable gaps (web driver, untestable)', () => {
    expect(status('s-web')).toBe('web');
    expect(byAnchor.get('s-web')!.reason).toBe('browser-only');
    expect(status('s-untestable')).toBe('untestable');
    expect(byAnchor.get('s-untestable')!.reason).toBe('no CLI surface');
  });

  it('marks a section with nothing bound as unguarded', () => {
    expect(status('s-unguarded')).toBe('unguarded');
  });

  // "Generate tried and could not" is NOT "nothing was ever tried" — before this
  // the two painted identically and the failure disappeared from every total.
  it('paints a section whose flow only errored at authoring as authoring-error', () => {
    const sa = byAnchor.get('s-author-error')!;
    expect(sa.status).toBe('authoring-error');
    expect(sa.flows.map((f) => f.flowId)).toEqual(['author-error-flow']);
    expect(sa.flows[0].surfaces).toEqual([{ surface: 'cli', status: 'authoring-error' }]);
    expect(sa.scenarioIds).toEqual([]);
  });

  it('re-anchors a moved section via remappedTo', () => {
    const sm = byAnchor.get('s-moved')!;
    expect(sm.status).toBe('pass');
    expect(sm.scenarios[0].remappedTo).toBe('s-moved');
    // The old anchor is not a live section.
    expect(byAnchor.has('s-old')).toBe(false);
  });

  it('collects guards for removed sections into orphanedSections', () => {
    expect(cov.orphanedSections).toEqual([
      { anchor: 's-removed', scenarioIds: ['so'], scenarios: [expect.objectContaining({ id: 'so', outcome: 'orphaned' })] },
    ]);
    // An orphaned scenario never lands on a live section.
    expect(cov.sections.some((s) => s.status === 'orphaned')).toBe(false);
  });

  it('tallies totals across the live sections and stamps provenance', () => {
    expect(cov.doc).toBe(DOC);
    expect(cov.markdown).toBe(true);
    expect(cov.sections).toHaveLength(14);
    expect(cov.runId).toBe('r1');
    expect(cov.ranAt).toBe('2026-07-07T00:00:00.000Z');
    expect(cov.generatedAt).toBe('2026-07-06T00:00:00.000Z');
    expect(cov.totals).toMatchObject({
      pass: 2, fail: 1, error: 1, stale: 1, guarded: 1,
      library: 1, web: 1, tui: 1, untestable: 1, 'no-claim': 1, 'blocked-on': 1,
      unguarded: 1, orphaned: 0, 'authoring-error': 1,
    });
  });

  it('reports unguarded for a doc with no store data', () => {
    const empty = composeDocCoverage(DOC, '# Solo\nbody', { manifest: null, latest: null, result: null });
    expect(empty.sections).toEqual([
      expect.objectContaining({ anchor: 'solo', status: 'unguarded', scenarioIds: [], scenarios: [] }),
    ]);
    expect(empty.runId).toBeNull();
    expect(empty.generatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item 65 — the needs-setup promotion, entirely inside the read model.
// ---------------------------------------------------------------------------

describe('composeDocCoverage — needs-setup (item 65)', () => {
  const EXTERNAL_DOC = 'docs/api.md';
  const EXTERNAL_CONTENT = ['# Forecast', 'a', '# Payments', 'b', '# Vague', 'c'].join('\n');
  const externalResult: GuardGenerateReport = {
    ...result,
    coverageGaps: [
      {
        doc: EXTERNAL_DOC,
        anchor: 'forecast',
        kind: 'blocked-on',
        reason: composeBlockedOnReason(['open-meteo'], 'the forecast comes from upstream'),
      },
      {
        doc: EXTERNAL_DOC,
        anchor: 'payments',
        kind: 'blocked-on',
        reason: composeBlockedOnReason(['stripe'], 'charges go to the payment provider'),
      },
      {
        doc: EXTERNAL_DOC,
        anchor: 'vague',
        kind: 'blocked-on',
        reason: composeBlockedOnReason(['external-service'], 'it calls something out there'),
      },
    ],
  };
  const compose = (externals: Record<string, 'provided' | 'incomplete' | 'unprovided'> | null) =>
    composeDocCoverage(EXTERNAL_DOC, EXTERNAL_CONTENT, {
      manifest: null,
      latest: null,
      result: externalResult,
      externals,
    });

  const joined = compose({ 'open-meteo': 'unprovided', stripe: 'provided' });
  const bySection = new Map(joined.sections.map((s) => [s.anchor, s]));

  it('promotes a gap naming a KNOWN, unprovided service — and says which', () => {
    const section = bySection.get('forecast')!;
    expect(section.status).toBe('needs-setup');
    expect(section.needsSetup).toEqual({ services: ['open-meteo'], provided: [] });
  });

  it('a PROVIDED service is the re-generate sub-state, not a to-do', () => {
    const section = bySection.get('payments')!;
    expect(section.status).toBe('needs-setup');
    expect(section.needsSetup).toEqual({ services: [], provided: ['stripe'] });
  });

  it('a GENERIC noun stays plain blocked-on, capability chips and all', () => {
    const section = bySection.get('vague')!;
    expect(section.status).toBe('blocked-on');
    expect(section.needsSetup).toBeUndefined();
    expect(section.blockedOnCapabilities).toEqual(['external-service']);
  });

  it('without externals data EVERY section stays plain blocked-on', () => {
    for (const externals of [null, {}]) {
      const plain = compose(externals);
      expect(plain.sections.map((s) => s.status)).toEqual([
        'blocked-on',
        'blocked-on',
        'blocked-on',
      ]);
      expect(plain.sections.every((s) => s.needsSetup === undefined)).toBe(true);
    }
  });

  it('changes NOTHING that is persisted — the gap kind and the totals buckets', () => {
    // The stored gap is untouched: this is a read-model promotion.
    expect(externalResult.coverageGaps.every((g) => g.kind === 'blocked-on')).toBe(true);
    expect(joined.totals['needs-setup']).toBe(2);
    expect(joined.totals['blocked-on']).toBe(1);
    // Every bucket still exists (the derived status did not knock one out).
    expect(joined.totals.pass).toBe(0);
    expect(joined.totals.unguarded).toBe(0);
  });
});
