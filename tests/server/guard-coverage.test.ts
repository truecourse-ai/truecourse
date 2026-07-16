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
  '# S Finding', 'n',
  '# S Held', 'o',
  '# S Auth Error', 'p',
].join('\n');

const fp = 'sha256:seed';
const binds = (section: string) => ({ doc: DOC, section, fingerprint: fp });

function scenario(over: Partial<GuardScenarioResult> & { id: string; section: string; outcome: GuardScenarioResult['outcome'] }): GuardScenarioResult {
  const { section, ...rest } = over;
  return { title: `t ${over.id}`, durationMs: 1, binds: binds(section), ...rest } as GuardScenarioResult;
}

const latest: GuardLatest = {
  run: { runId: 'r1', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
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
  guard: 1,
  sections: [
    { doc: DOC, anchor: 's-guarded', fingerprint: fp, scenarioIds: ['sg1'], generationInputsHash: null },
    { doc: DOC, anchor: 's-web', fingerprint: fp, scenarioIds: [], generationInputsHash: null, classification: { driver: 'web', reason: 'browser-only' } },
    { doc: DOC, anchor: 's-untestable', fingerprint: fp, scenarioIds: [], generationInputsHash: null, classification: { untestable: true, reason: 'no CLI surface' } },
  ],
};

const result: GuardGenerateReport = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 15,
  sectionsChanged: 0,
  skippedUnchanged: 15,
  noChanges: false,
  written: [],
  coverageGaps: [
    { doc: DOC, anchor: 's-api', kind: 'awaiting-driver', driver: 'api', reason: 'needs the api driver' },
    { doc: DOC, anchor: 's-tui', kind: 'awaiting-driver', driver: 'tui', reason: 'terminal UI only' },
    { doc: DOC, anchor: 's-no-claim', kind: 'no-claim', reason: 'no assertable claim' },
    { doc: DOC, anchor: 's-blocked', kind: 'blocked-on', reason: composeBlockedOnReason(['git', 'db'], 'needs a git repo and a database') },
  ],
  birthFindings: [
    // Another doc's finding first, so the projected `index` proves it is the
    // finding's position in the FULL report array (the Scenarios-tab key basis).
    { doc: 'docs/other.md', anchor: 'elsewhere', title: 'other-doc finding', step: 1, expected: 'a', actual: 'b' },
    { doc: DOC, anchor: 's-finding', title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2', evidencePath: '.truecourse/guard/evidence/birth/bf' },
  ],
  errors: [
    // Another doc's error, proving the join filters by doc.
    { doc: 'docs/other.md', anchor: 'elsewhere', message: 'other-doc authoring error' },
    // An error-only section: two attempts of the SAME message dedupe to one entry
    // with attempts:2, a third distinct message stays separate.
    { doc: DOC, anchor: 's-auth-error', message: 'timed out after 10m' },
    { doc: DOC, anchor: 's-auth-error', message: 'timed out after 10m' },
    { doc: DOC, anchor: 's-auth-error', message: 'invalid output twice' },
    // A held section whose blocker WAS an authoring error — held must still win.
    { doc: DOC, anchor: 's-held', message: 'sibling authoring error' },
  ],
  extractionFailures: [],
  orphaned: [],
  heldSections: [
    { doc: DOC, anchor: 's-finding', readyScenarios: [
      { id: 'hf1', title: 'held by the finding 1', yaml: 'id: hf1' },
      { id: 'hf2', title: 'held by the finding 2', yaml: 'id: hf2' },
    ] },
    { doc: DOC, anchor: 's-held', readyScenarios: [{ id: 'sh1', title: 'held by a sibling error', yaml: 'id: sh1' }] },
    { doc: 'docs/other.md', anchor: 'elsewhere', readyScenarios: [{ id: 'xx1', title: 'other doc', yaml: 'id: xx1' }] },
  ],
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

  it('maps coverage gaps (api / tui / no-claim) with their reasons', () => {
    expect(status('s-api')).toBe('api');
    expect(byAnchor.get('s-api')!.reason).toBe('needs the api driver');
    expect(status('s-tui')).toBe('tui');
    expect(status('s-no-claim')).toBe('no-claim');
  });

  it('parses blocked-on capabilities from the gap reason', () => {
    const sb = byAnchor.get('s-blocked')!;
    expect(sb.status).toBe('blocked-on');
    expect(sb.blockedOnCapabilities).toEqual(['git', 'db']);
  });

  it('reads a bare manifest classification (web driver, untestable)', () => {
    expect(status('s-web')).toBe('web');
    expect(byAnchor.get('s-web')!.reason).toBe('browser-only');
    expect(status('s-untestable')).toBe('untestable');
    expect(byAnchor.get('s-untestable')!.reason).toBe('no CLI surface');
  });

  it('marks a section with nothing bound as unguarded', () => {
    expect(status('s-unguarded')).toBe('unguarded');
  });

  it('paints an unsettled section with a birth finding, projecting its findings + held scenarios', () => {
    const sf = byAnchor.get('s-finding')!;
    expect(sf.status).toBe('finding');
    expect(sf.reason).toBe('1 birth finding awaiting a decision · holds 2 ready scenarios');
    expect(sf.findings).toEqual([
      { index: 1, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2', evidencePath: '.truecourse/guard/evidence/birth/bf' },
    ]);
    expect(sf.heldScenarios).toEqual([
      { id: 'hf1', title: 'held by the finding 1' },
      { id: 'hf2', title: 'held by the finding 2' },
    ]);
  });

  it('paints an unsettled section with only held scenarios as held, listing its sibling authoring error as blocker context', () => {
    const sh = byAnchor.get('s-held')!;
    expect(sh.status).toBe('held');
    expect(sh.reason).toBe('1 ready scenario held — the section did not settle');
    expect(sh.heldScenarios).toEqual([{ id: 'sh1', title: 'held by a sibling error' }]);
    expect(sh.findings).toBeUndefined();
    // held wins over authoring-error, but the blocker rides along as context.
    expect(sh.authoringErrors).toEqual([{ message: 'sibling authoring error', attempts: 1 }]);
  });

  it('paints an error-only section as authoring-error with a deduped, attempt-counted reason', () => {
    const sa = byAnchor.get('s-auth-error')!;
    expect(sa.status).toBe('authoring-error');
    expect(sa.reason).toBe('authoring failed — 3 attempts; re-run generate to retry');
    // Retries of the same message collapse to one entry with attempts:2, in first-seen order.
    expect(sa.authoringErrors).toEqual([
      { message: 'timed out after 10m', attempts: 2 },
      { message: 'invalid output twice', attempts: 1 },
    ]);
    // No manifest entry, gap, or finding — the sole record is the errors.
    expect(sa.scenarioIds).toEqual([]);
    expect(sa.findings).toBeUndefined();
  });

  it('never conflates the authoring-error status with the RUN error outcome', () => {
    expect(status('s-error')).toBe('error');
    expect(status('s-auth-error')).toBe('authoring-error');
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
    expect(cov.sections).toHaveLength(16);
    expect(cov.runId).toBe('r1');
    expect(cov.ranAt).toBe('2026-07-07T00:00:00.000Z');
    expect(cov.generatedAt).toBe('2026-07-06T00:00:00.000Z');
    expect(cov.totals).toMatchObject({
      pass: 2, fail: 1, error: 1, stale: 1, guarded: 1,
      api: 1, web: 1, tui: 1, untestable: 1, 'no-claim': 1, 'blocked-on': 1,
      finding: 1, held: 1, 'authoring-error': 1, unguarded: 1, orphaned: 0,
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
