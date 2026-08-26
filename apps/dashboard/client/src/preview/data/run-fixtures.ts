/**
 * The fake runs (./repos.ts, ./other-repos.ts) folded into the EXACT payload
 * shapes the vendored RUN surfaces consume, so the Runs tab renders the
 * vendored `GuardDriftsView` / `GuardRunSummary` / `GuardDriftList` / `GuardDriftDetail`
 * / `GuardTestView` unchanged:
 *
 *   - `GuardLatestWithRunFlows` (the latest and per-run endpoints): the run
 *     envelope, its summary, one result per executed scenario, the per-section
 *     rollup, and the flow join that paints a result as a flow instance;
 *   - `GuardHistory` (the history endpoint): one summary row per run;
 *   - `GuardScenarioSource` (the scenario endpoint): the committed steps behind
 *     one result;
 *   - the evidence transcript (text/plain), which the detail opens in place.
 *
 * A run only reports what EXECUTED. The board's blocked tests never produced a
 * scenario (see ./flow-fixtures.ts), so they carry no result here , the real
 * outcome vocabulary has no "blocked", and inventing one would be a status the
 * product does not have.
 */

import type {
  GuardHistory,
  GuardHistoryEntry,
  GuardLatestWithRunFlows,
  GuardOutcome,
  GuardRunFlow,
  GuardScenarioResult,
  GuardScenarioSource,
  GuardScenarioStepView,
  GuardStepKind,
  GuardSectionRollup,
  GuardSummary,
} from '@/preview/vendor/shared';
import {
  agoIso,
  bindingFor,
  fakeFingerprint,
  flowIdFor,
  flowsFor,
  hashInt,
  interfacePathFor,
  milestonesFor,
  scenarioFileFor,
  scenarioIdFor,
  testByScenarioId,
  testsForRepo,
  testSurface,
} from './flow-fixtures';
import { REPO_GUARD } from './index';
import { coverageVersions } from './corpus';
import type { GuardTest, Run } from './types';

/** The coverage version a run executed: the PR's own version when the PR changed specs, else the baseline. */
function coverageVersionOf(repoId: string, run: Run): string {
  const versions = coverageVersions(repoId);
  const own = run.prNumber != null ? versions.find((v) => v.pullRequest === run.prNumber) : undefined;
  return (own ?? versions[0]!).id;
}

function runsForRepo(repoId: string): Run[] {
  return REPO_GUARD[repoId]?.runs ?? [];
}

function durationOf(test: GuardTest): number {
  return 600 + hashInt(test.id, 5400);
}

/** One executed test's result in this run. */
function resultFor(repoId: string, test: GuardTest, outcome: GuardOutcome, run: Run): GuardScenarioResult {
  const scenarioId = scenarioIdFor(repoId, test)!;
  const binds = bindingFor(repoId, test);
  const failedIndex = test.steps.findIndex((s) => !s.ok);
  const failing = outcome === 'fail' && failedIndex >= 0;
  return {
    id: scenarioId,
    title: test.name,
    binds: { doc: binds.doc, section: binds.anchor, fingerprint: binds.fingerprint },
    outcome,
    stage: 'run',
    durationMs: durationOf(test),
    ...(failing
      ? {
          failure: {
            step: failedIndex + 1,
            expected: test.steps[failedIndex]!.expected,
            actual: test.steps[failedIndex]!.actual,
          },
          failedMilestone: failedIndex + 1,
        }
      : {}),
    evidencePath: `guard/evidence/${run.id}/${scenarioId}`,
    flowId: flowIdFor(test),
  };
}

/** The flows the run's results reference, with the milestone chain each paints. */
function runFlowsFor(repoId: string, results: GuardScenarioResult[]): GuardRunFlow[] {
  const wanted = new Set(results.map((r) => r.flowId).filter((id): id is string => Boolean(id)));
  return flowsFor(repoId)
    .filter((f) => wanted.has(f.flowId))
    .map((f) => ({
      flowId: f.flowId,
      title: f.title,
      goal: f.goal,
      epic: false,
      milestones: milestonesFor(repoId, f).map((m) => ({
        order: m.order,
        doc: m.doc,
        anchor: m.anchor,
        claimTitle: m.claimTitle,
      })),
    }));
}

function summarize(results: GuardScenarioResult[]): GuardSummary {
  const count = (o: GuardOutcome) => results.filter((r) => r.outcome === o).length;
  return {
    total: results.length,
    pass: count('pass'),
    fail: count('fail'),
    stale: count('stale'),
    orphaned: count('orphaned'),
    error: count('error'),
    blocked: 0,
  };
}

/** Worst outcome per bound section , the rollup the coverage surfaces read back. */
function rollups(results: GuardScenarioResult[]): GuardSectionRollup[] {
  const byKey = new Map<string, GuardSectionRollup>();
  for (const r of results) {
    const key = `${r.binds.doc}\u0000${r.binds.section}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        doc: r.binds.doc,
        section: r.binds.section,
        status: r.outcome,
        scenarioIds: [r.id],
      });
      continue;
    }
    existing.scenarioIds.push(r.id);
    if (r.outcome === 'fail' || (r.outcome === 'error' && existing.status !== 'fail')) {
      existing.status = r.outcome;
    }
  }
  return [...byKey.values()];
}

/** One preview run as the run payload the dashboard reads. */
export function runPayload(repoId: string, run: Run): GuardLatestWithRunFlows {
  const results: GuardScenarioResult[] = [];
  for (const verdict of run.tests) {
    if (verdict.verdict === 'blocked') continue;
    const test = testsForRepo(repoId).find((t) => t.id === verdict.testId);
    if (!test || !scenarioIdFor(repoId, test)) continue;
    results.push(resultFor(repoId, test, verdict.verdict === 'failed' ? 'fail' : 'pass', run));
  }
  return {
    run: {
      runId: run.id,
      ranAt: agoIso(run.at),
      branch: run.branch,
      commit: run.sha,
      recipeFingerprint: fakeFingerprint(`${repoId}/recipe`),
      ...(run.prNumber != null ? { pullRequest: run.prNumber } : {}),
      origin: run.origin,
      coverageVersion: coverageVersionOf(repoId, run),
    },
    summary: summarize(results),
    scenarios: results,
    sections: rollups(results),
    runFlows: runFlowsFor(repoId, results),
  };
}

/** The newest run of a repo, or null when nothing ever ran (mid-onboarding). */
export function latestRun(repoId: string): GuardLatestWithRunFlows | null {
  const run = runsForRepo(repoId)[0];
  return run ? runPayload(repoId, run) : null;
}

/** The newest run recorded on one commit (a pull request head), or null. */
export function latestRunOnCommit(repoId: string, sha: string): GuardLatestWithRunFlows | null {
  const run = runsForRepo(repoId).find((r) => r.sha === sha);
  return run ? runPayload(repoId, run) : null;
}

export function runById(repoId: string, runId: string): GuardLatestWithRunFlows | null {
  const run = runsForRepo(repoId).find((r) => r.id === runId);
  return run ? runPayload(repoId, run) : null;
}

/** The append-only run history, newest first (the order the board lists them). */
export function runHistory(repoId: string, prNumber?: number): GuardHistory {
  const source = prNumber == null ? runsForRepo(repoId) : runsForRepo(repoId).filter((r) => r.prNumber === prNumber);
  const runs: GuardHistoryEntry[] = source.map((run) => {
    const payload = runPayload(repoId, run);
    return {
      runId: run.id,
      ranAt: payload.run.ranAt,
      branch: run.branch,
      commit: run.sha,
      summary: payload.summary,
      ...(run.prNumber != null ? { pullRequest: run.prNumber } : {}),
      origin: run.origin,
      coverageVersion: payload.run.coverageVersion,
    };
  });
  return { runs };
}

/** The steps of one committed test, as the detail renders them. */
function stepViews(test: GuardTest): GuardScenarioStepView[] {
  return test.steps.map((step, i) => ({
    n: i + 1,
    kind: step.driver as GuardStepKind,
    command: step.invocation.split('\n').join(' ; '),
    expectation: step.expected,
    milestone: i + 1,
    claims: [step.claim],
    note: step.milestone,
  }));
}

/** The YAML the steps were committed as , the detail's source view. */
function scenarioYaml(repoId: string, test: GuardTest, scenarioId: string): string {
  const binds = bindingFor(repoId, test);
  const lines = [
    `id: ${scenarioId}`,
    `title: ${test.name}`,
    `driver: ${testSurface(test)}`,
    `flow:`,
    `  id: ${flowIdFor(test)}`,
    `binds:`,
    `  - doc: ${binds.doc}`,
    `    section: ${binds.anchor}`,
    `steps:`,
  ];
  for (const step of test.steps) {
    lines.push(`  - run: ${JSON.stringify(step.invocation.split('\n'))}`);
    lines.push(`    expect: ${JSON.stringify(step.expected)}`);
  }
  return lines.join('\n');
}

/** One scenario's committed source, or null when the id belongs to no test. */
export function scenarioSource(repoId: string, scenarioId: string): GuardScenarioSource | null {
  const test = testByScenarioId(repoId, scenarioId);
  if (!test) return null;
  const file = scenarioFileFor(test);
  return {
    id: scenarioId,
    file: file ?? `scenarios/${flowIdFor(test)}.yaml`,
    content: scenarioYaml(repoId, test, scenarioId),
    steps: stepViews(test),
  };
}

/** The transcript a failure's evidence bundle holds, as text/plain. */
export function evidenceText(repoId: string, scenarioId: string): string | null {
  const test = testByScenarioId(repoId, scenarioId);
  if (!test) return null;
  const lines = [
    `# ${test.name}`,
    `scenario: ${scenarioId}`,
    `surface: ${testSurface(test)}`,
    `interfaces: ${interfacePathFor(test).join(', ') || 'none'}`,
    '',
  ];
  for (const [i, step] of test.steps.entries()) {
    lines.push(`--- step ${i + 1}: ${step.title} ---`);
    lines.push(step.invocation);
    lines.push(`expected: ${step.expected}`);
    lines.push(`actual:   ${step.actual}`);
    lines.push('');
  }
  lines.push('--- adjudication ---', test.transcript);
  for (const tile of test.evidence) lines.push(`artifact: ${tile.label} (${tile.at})`);
  return lines.join('\n');
}

/** The same transcript addressed by its stored path (a birth finding's pointer). */
export function evidenceByPath(repoId: string, path: string): string | null {
  const scenarioId = path.split('/').pop() ?? '';
  return evidenceText(repoId, scenarioId);
}
