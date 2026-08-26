/**
 * The fake board (./orders-api.tests.ts, ./other-repos.ts) folded into the EXACT
 * payload shapes the vendored FLOWS surfaces consume, so the Tests tab
 * renders the vendored `GuardFlowsPanel` / `GuardFlowsPane` / `GuardFlowDetail`
 * unchanged:
 *
 *   - `GuardFlowsView` (the flows endpoint): one flow per distinct `test.flow`,
 *     its per-surface rows, its buckets and the recipe card that rides along;
 *   - `GuardFlowDetail` (the per-flow endpoint): the milestone chain bound to the
 *     corpus sections the tests prove, the scenario rows, the gaps and interfaces;
 *   - `GuardGenerateReport` (the report endpoint) and `GuardDecisions` (the
 *     dismissals), which the same pane reads;
 *   - `GuardScenarioInventory` (the scenarios endpoint), the committed test rows
 *     the merged detail joins a spec binding from;
 *   - `GuardClaimsView` (the claims endpoint), the claim sentences a milestone
 *     group is headed with.
 *
 * This module also owns the IDENTITIES every other fixture joins on, so a run's
 * scenario ids, a section's flow ids and an interface's grounding ids are all the
 * same strings:
 *
 *   flow id      slug of the test's flow name        `refund-partial-capture`
 *   scenario id  `<flowId>.<surface>.<n>`            `refund-partial-capture.api.1`
 *   binding      the corpus section whose `tests` names the test
 *
 * A test's PRIMARY driver is its surface: the real model gives one scenario one
 * driver, so a preview test whose steps span several is realized on the first.
 * A blocked or not-testable test is a GAP row and carries no scenario id, which
 * is why no run result ever mentions one.
 */

import {
  worstCoverageStatus,
  type GuardDriverId,
  type GuardFlowBucket,
  type GuardFlowDetail,
  type GuardFlowGap,
  type GuardFlowListItem,
  type GuardFlowMilestoneView,
  type GuardFlowScenarioRow,
  type GuardFlowSurface,
  type GuardFlowSurfaceGap,
  type GuardFlowsView,
  type GuardGenerateReport,
  type GuardClaimRow,
  type GuardClaimsView,
  type GuardRecipeCard,
  type GuardRecipeSurface,
  type GuardScenarioInventory,
  type GuardScenarioListItem,
  type GuardUntestableRow,
  type GuardSectionCoverageStatus,
} from '@/preview/vendor/shared';
import { docsForRepo, type SpecDoc, type SpecSection } from './corpus';
import { REPO_GUARD } from './index';
import type { GuardTest, StepDriver, TestStatus } from './types';

/** The instant the preview's relative timestamps ("11 minutes ago") are read from. */
export const PREVIEW_NOW = Date.parse('2026-08-21T13:31:00.000Z');

/** When the last generate ran, everywhere it is quoted. */
export const GENERATED_AT = '2026-08-21T11:05:00.000Z';

const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** "11 minutes ago" / "Yesterday" as the ISO instant the real payloads carry. */
export function agoIso(label: string): string {
  const text = label.trim();
  const m = /^(\d+)\s+(minute|hour|day)s?\s+ago$/i.exec(text);
  if (m) return new Date(PREVIEW_NOW - Number(m[1]) * (UNIT_MS[m[2]!.toLowerCase()] ?? 0)).toISOString();
  if (/^yesterday$/i.test(text)) return new Date(PREVIEW_NOW - UNIT_MS.day!).toISOString();
  return new Date(PREVIEW_NOW).toISOString();
}

export function slugify(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A stable fake digest: the shape is what matters, never the bytes. */
export function fakeFingerprint(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `sha256:${h.toString(16).padStart(8, '0').repeat(8)}`;
}

/** A deterministic small number from a string, durations, counts, nothing load-bearing. */
export function hashInt(seed: string, span: number): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % span;
}

/** The preview board's status words in the real coverage vocabulary. */
export const COVERAGE_STATUS: Record<TestStatus, GuardSectionCoverageStatus> = {
  passing: 'pass',
  failing: 'fail',
  blocked: 'needs-setup',
  'not-testable': 'untestable',
  'never-run': 'guarded',
};

/** The driver a test's scenario runs on, the real model gives a scenario one. */
export function testSurface(test: GuardTest): GuardDriverId {
  return (test.drivers[0] ?? 'cli') as StepDriver as GuardDriverId;
}

export function flowIdFor(test: GuardTest): string {
  return slugify(test.flow);
}

/** True when the test produced a scenario at all (a gap row has none). */
export function hasScenario(test: GuardTest): boolean {
  return test.status === 'passing' || test.status === 'failing' || test.status === 'never-run';
}

/** `<flowId>.<surface>.<n>`, the id shape every guard read joins on. */
export function scenarioIdFor(repoId: string, test: GuardTest): string | null {
  if (!hasScenario(test)) return null;
  const surface = testSurface(test);
  const flowId = flowIdFor(test);
  const siblings = testsForRepo(repoId).filter(
    (t) => flowIdFor(t) === flowId && testSurface(t) === surface && hasScenario(t),
  );
  const n = siblings.findIndex((t) => t.id === test.id) + 1;
  return `${flowId}.${surface}.${Math.max(1, n)}`;
}

export function testsForRepo(repoId: string): GuardTest[] {
  return REPO_GUARD[repoId]?.tests ?? [];
}

/** The test behind a scenario id, or undefined. */
export function testByScenarioId(repoId: string, scenarioId: string): GuardTest | undefined {
  return testsForRepo(repoId).find((t) => scenarioIdFor(repoId, t) === scenarioId);
}

/** The doc anchor rule the coverage payload uses: the slug path of the heading chain. */
export function sectionAnchor(doc: SpecDoc, section: SpecSection): string {
  return `${slugify(doc.title)}/${slugify(section.heading)}`;
}

export interface PreviewBinding {
  doc: string;
  anchor: string;
  headingText: string;
  fingerprint: string;
}

/** The corpus section a test proves, every guard payload binds to the same one. */
export function bindingFor(repoId: string, test: GuardTest): PreviewBinding {
  for (const doc of docsForRepo(repoId)) {
    for (const section of doc.sections) {
      if (section.tests.includes(test.id)) {
        return {
          doc: doc.path,
          anchor: sectionAnchor(doc, section),
          headingText: section.heading,
          fingerprint: fakeFingerprint(doc.path + section.heading),
        };
      }
    }
  }
  const fallback = `docs/${slugify(test.area)}.md`;
  return {
    doc: fallback,
    anchor: `${slugify(test.area)}/${slugify(test.flow)}`,
    headingText: test.flow,
    fingerprint: fakeFingerprint(fallback + test.flow),
  };
}

/** The services a blocked test is waiting on, named the way the externals page names them. */
function blockedServices(test: GuardTest): string[] {
  const text = `${test.reason ?? ''} ${test.facts.map((f) => f.value).join(' ')}`.toLowerCase();
  const deps = REPO_GUARD[repoOf(test)]?.dependencies ?? [];
  const named = deps
    .filter((d) => d.klass === 'supplied' && (text.includes(d.service) || text.includes(d.name.toLowerCase())))
    .map((d) => d.service);
  return named.length > 0 ? [...new Set(named)] : ['external-service'];
}

/** Which repo a test belongs to, the board is per repo, so a scan finds it once. */
function repoOf(test: GuardTest): string {
  for (const [repoId, guard] of Object.entries(REPO_GUARD)) {
    if (guard.tests.some((t) => t.id === test.id)) return repoId;
  }
  return '';
}

/** The gap behind a blocked / not-testable test, in the real gap vocabulary. */
export function gapFor(test: GuardTest): GuardFlowGap | null {
  if (test.status === 'blocked') {
    const services = blockedServices(test);
    return {
      kind: 'blocked-on',
      reason: test.reason ?? `Blocked on ${services.join(' and ')}.`,
      label: 'needs setup',
      needsSetup: { services, provided: [] },
    };
  }
  if (test.status === 'not-testable') {
    return {
      kind: 'untestable',
      reason: test.reason ?? 'No interface observes what the claim states.',
      label: 'untestable',
    };
  }
  return null;
}

/** One surface of a flow, the shape a coverage section and a flow row both carry. */
export function flowSurfaceFor(repoId: string, test: GuardTest): GuardFlowSurface {
  const status = COVERAGE_STATUS[test.status];
  const gap = gapFor(test);
  const base: GuardFlowSurface = { surface: testSurface(test), status };
  if (gap) return { ...base, gap };
  const scenarioId = scenarioIdFor(repoId, test)!;
  if (test.status === 'never-run') return { ...base, scenarioId };
  return {
    ...base,
    scenarioId,
    outcome: test.status === 'passing' ? 'pass' : 'fail',
    stage: 'run',
  };
}

export interface PreviewFlow {
  flowId: string;
  title: string;
  goal: string;
  tests: GuardTest[];
}

/** The flows of a repo: one per distinct `test.flow`, in board order. */
export function flowsFor(repoId: string): PreviewFlow[] {
  const byId = new Map<string, PreviewFlow>();
  for (const test of testsForRepo(repoId)) {
    const flowId = flowIdFor(test);
    const existing = byId.get(flowId);
    if (existing) existing.tests.push(test);
    else
      byId.set(flowId, {
        flowId,
        title: test.flow,
        goal: test.steps[test.steps.length - 1]?.milestone ?? test.name,
        tests: [test],
      });
  }
  return [...byId.values()];
}

function bucketOf(surfaces: GuardFlowSurface[]): GuardFlowBucket {
  const withGap = surfaces.filter((s) => s.gap).length;
  const withTest = surfaces.length - withGap;
  if (surfaces.length === 0) return 'ungenerated';
  if (withGap > 0) return withTest > 0 ? 'partial' : 'blocked';
  return 'guarded';
}

/** Every step of every test in the flow, as the milestone chain the detail paints. */
export function milestonesFor(repoId: string, flow: PreviewFlow): GuardFlowMilestoneView[] {
  const rows: GuardFlowMilestoneView[] = [];
  for (const test of flow.tests) {
    const binds = bindingFor(repoId, test);
    for (const step of test.steps) {
      rows.push({
        order: rows.length + 1,
        doc: binds.doc,
        anchor: binds.anchor,
        claimTitle: step.claim,
        note: step.milestone,
        headingText: binds.headingText,
        live: true,
        boundFingerprint: binds.fingerprint,
        currentFingerprint: binds.fingerprint,
        drifted: false,
      });
    }
  }
  return rows;
}

/** The interfaces a test grounds on, in the catalog's id form. */
export function interfacePathFor(test: GuardTest): string[] {
  return test.interfacesUsed.map((id) => id.replace(':', '/'));
}

function latestRunOf(repoId: string) {
  return REPO_GUARD[repoId]?.runs[0] ?? null;
}

/**
 * The preparation recipe as the card the Interfaces pane and the Tests overview
 * render: ONE `GuardRecipeSurface` per surface the board declares a recipe for,
 * keyed by driver id. The board's recipe is a step list, so the last "start"
 * step becomes the surface's `serve` argv, the last step of a cli recipe its
 * `entry` argv, and everything else its `build` chain.
 */
export function recipeCard(repoId: string): GuardRecipeCard | null {
  const recipes = REPO_GUARD[repoId]?.recipes ?? [];
  if (recipes.length === 0) return null;
  const surfaces: Partial<Record<GuardDriverId, GuardRecipeSurface>> = {};
  for (const recipe of recipes) {
    const serveStep = [...recipe.steps].reverse().find((s) => /start|serve|preview/.test(s));
    const entryStep = recipe.surface === 'cli' ? recipe.steps[recipe.steps.length - 1] : undefined;
    const build = recipe.steps.filter((s) => s !== serveStep && s !== entryStep && !/^wait for/.test(s));
    const surface: GuardRecipeSurface = {
      ...(build.length > 0 ? { build: build.join(' && ') } : {}),
      ...(entryStep ? { entry: entryStep.split(' ') } : {}),
      ...(serveStep ? { serve: serveStep.split(' ') } : {}),
      ...(recipe.surface === 'api' ? { healthPath: '/healthz' } : {}),
      cwd: 'sandbox',
    };
    surfaces[recipe.surface as GuardDriverId] = surface;
  }
  return {
    surfaces,
    fingerprint: fakeFingerprint(`${repoId}/recipe`),
    stale: false,
  };
}

/** The Flows-tab payload. */
export function flowsView(repoId: string): GuardFlowsView {
  const flows = flowsFor(repoId);
  const run = latestRunOf(repoId);
  const items: GuardFlowListItem[] = flows.map((flow) => {
    const surfaces = flow.tests.map((t) => flowSurfaceFor(repoId, t));
    const bindings = flow.tests.map((t) => bindingFor(repoId, t));
    return {
      flowId: flow.flowId,
      title: flow.title,
      goal: flow.goal,
      status: worstCoverageStatus(surfaces.map((s) => s.status)),
      bucket: bucketOf(surfaces),
      epic: false,
      composedOf: [],
      manual: false,
      milestoneCount: flow.tests.reduce((n, t) => n + t.steps.length, 0),
      sectionCount: new Set(bindings.map((b) => `${b.doc}#${b.anchor}`)).size,
      docs: [...new Set(bindings.map((b) => b.doc))],
      surfaces,
      // The drivers the flow's TESTS exercise: the union of their step kinds,
      // not the scenario-level surface, which is what the panel's driver chips
      // narrow on.
      drivers: [...new Set(flow.tests.flatMap((t) => t.drivers))] as GuardDriverId[],
      // A committed failing test IS its own surface row; the birth-finding tier is
      // empty here, so the count that drives the "failing" word stays with it.
      findings: 0,
      toolDefects: 0,
      errors: 0,
      interfaceDrifted: false,
    };
  });
  const bucket = (b: GuardFlowBucket) => items.filter((f) => f.bucket === b).length;
  const noFlowClaims = docsForRepo(repoId)
    .flatMap((d) => d.sections)
    .filter((s) => s.tests.length === 0)
    .reduce((n, s) => n + s.claims, 0);
  return {
    flows: items,
    totals: {
      total: items.length,
      guarded: bucket('guarded'),
      partial: bucket('partial'),
      blocked: bucket('blocked'),
      ungenerated: bucket('ungenerated'),
      manual: 0,
    },
    noFlowClaims,
    synthesized: items.length > 0,
    generatedAt: GENERATED_AT,
    runId: run?.id ?? null,
    ranAt: run ? agoIso(run.at) : null,
    recipe: recipeCard(repoId),
  };
}

/** The file a test's steps were committed to, as its facts record it. */
export function scenarioFileFor(test: GuardTest): string | undefined {
  const fact = test.facts.find((f) => f.label === 'Scenario file')?.value;
  return fact && fact.includes('/') ? fact : undefined;
}

function scenarioRow(repoId: string, test: GuardTest): GuardFlowScenarioRow {
  const status = COVERAGE_STATUS[test.status];
  const gap = gapFor(test);
  const surface = testSurface(test);
  if (gap) {
    return {
      surface,
      status,
      birthPassed: false,
      hasEvidence: false,
      interfacePath: interfacePathFor(test),
      gap,
    };
  }
  const scenarioId = scenarioIdFor(repoId, test)!;
  const failing = test.status === 'failing';
  const failedIndex = test.steps.findIndex((s) => !s.ok);
  const file = scenarioFileFor(test);
  return {
    surface,
    scenarioId,
    title: test.name,
    ...(file ? { file } : {}),
    status,
    birthPassed: test.status !== 'failing',
    ...(test.lastRun ? { stage: 'run' as const } : {}),
    ...(test.status === 'passing' ? { outcome: 'pass' as const } : {}),
    ...(failing ? { outcome: 'fail' as const } : {}),
    durationMs: 600 + hashInt(test.id, 5400),
    ...(failing && failedIndex >= 0
      ? {
          failure: {
            step: failedIndex + 1,
            expected: test.steps[failedIndex]!.expected,
            actual: test.steps[failedIndex]!.actual,
          },
          failedMilestone: failedIndex + 1,
          evidencePath: `guard/evidence/${test.lastRun?.runId ?? 'unrun'}/${scenarioId}`,
        }
      : {}),
    interfaceDrifted: false,
    hasEvidence: test.evidence.length > 0,
    interfacePath: interfacePathFor(test),
  };
}

/** One flow's detail, or null when the id is not in this repo's corpus. */
export function flowDetail(repoId: string, flowId: string): GuardFlowDetail | null {
  const flow = flowsFor(repoId).find((f) => f.flowId === flowId);
  if (!flow) return null;
  const run = latestRunOf(repoId);
  const surfaces = flow.tests.map((t) => scenarioRow(repoId, t));
  const gaps: GuardFlowSurfaceGap[] = surfaces
    .filter((s) => s.gap)
    .map((s) => ({ ...s.gap!, surface: s.surface ?? 'cli' }));
  return {
    flowId: flow.flowId,
    title: flow.title,
    goal: flow.goal,
    status: worstCoverageStatus(surfaces.map((s) => s.status)),
    bucket: bucketOf(flow.tests.map((t) => flowSurfaceFor(repoId, t))),
    epic: false,
    manual: false,
    composedOf: [],
    fingerprint: fakeFingerprint(`${repoId}/${flow.flowId}`),
    milestones: milestonesFor(repoId, flow),
    surfaces,
    gaps,
    interfaceIds: [...new Set(flow.tests.flatMap(interfacePathFor))],
    findings: [],
    errors: [],
    generatedAt: GENERATED_AT,
    runId: run?.id ?? null,
    ranAt: run ? agoIso(run.at) : null,
  };
}

/** The last generate, as the overview's one line reads it. */
export function generateReport(repoId: string): GuardGenerateReport {
  const sections = docsForRepo(repoId).flatMap((d) => d.sections);
  return {
    generatedAt: GENERATED_AT,
    status: 'ok',
    sectionsTotal: sections.length,
    sectionsChanged: 0,
    skippedUnchanged: sections.length,
    noChanges: true,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

/**
 * The committed TEST inventory. The merged Tests detail reads exactly one fact
 * from it, the spec section a test binds to, so every row carries its binding
 * and the recipe rides along the way the real payload has it.
 */
export function scenarioInventory(repoId: string): GuardScenarioInventory {
  const scenarios: GuardScenarioListItem[] = [];
  for (const test of testsForRepo(repoId)) {
    const id = scenarioIdFor(repoId, test);
    if (!id) continue;
    const binds = bindingFor(repoId, test);
    scenarios.push({
      id,
      title: test.name,
      doc: binds.doc,
      anchor: binds.anchor,
      headingText: binds.headingText,
      file: scenarioFileFor(test) ?? `scenarios/${slugify(test.area)}/${id}.yaml`,
      handWritten: false,
      flowId: flowIdFor(test),
      drivers: test.drivers as GuardDriverId[],
      status: test.status === 'failing' ? 'failing' : 'passing',
    });
  }
  return { recipe: recipeCard(repoId), scenarios };
}

/**
 * The claim corpus. One claim per step of every test, plus the untestable rows
 * the not-testable tests stand for: the Tests tab heads a milestone group with
 * the claim SENTENCE, and the Coverage tab lists what a section states, so both
 * read the same ledger.
 */
export function claimsView(repoId: string): GuardClaimsView {
  const claims: GuardClaimRow[] = [];
  const untestable: GuardUntestableRow[] = [];
  for (const flow of flowsFor(repoId)) {
    let order = 0;
    for (const test of flow.tests) {
      const binds = bindingFor(repoId, test);
      const scenarioId = scenarioIdFor(repoId, test);
      if (test.status === 'not-testable') {
        untestable.push({
          doc: binds.doc,
          anchor: binds.anchor,
          text: test.steps[0]?.claim ?? test.name,
          reason: test.reason ?? 'No interface observes what the claim states.',
          headingText: binds.headingText,
          anchorLive: true,
        });
        continue;
      }
      test.steps.forEach((step, index) => {
        order += 1;
        const failing = test.status === 'failing' && !step.ok;
        claims.push({
          id: step.claim,
          doc: binds.doc,
          anchor: binds.anchor,
          title: step.title,
          claim: step.expected,
          contentHash: fakeFingerprint(step.claim),
          headingText: binds.headingText,
          anchorLive: true,
          coverage: failing ? 'failing' : test.status === 'blocked' ? 'gapped' : 'proven',
          ...(test.status === 'blocked' ? { gapReason: test.reason ?? 'Blocked on a dependency.' } : {}),
          dismissed: false,
          flows: [{ flowId: flow.flowId, title: flow.title, milestoneOrder: order, note: step.milestone }],
          scenarios: scenarioId
            ? [
                {
                  scenarioId,
                  title: test.name,
                  steps: [index + 1],
                  ...(test.status === 'passing' ? { outcome: 'pass' as const } : {}),
                  ...(test.status === 'failing' ? { outcome: 'fail' as const } : {}),
                },
              ]
            : [],
        });
      });
    }
  }
  const count = (c: GuardClaimRow['coverage']) => claims.filter((r) => r.coverage === c).length;
  return {
    extracted: claims.length > 0,
    generatedAt: GENERATED_AT,
    claims,
    untestable,
    totals: {
      claims: claims.length,
      proven: count('proven'),
      failing: count('failing'),
      planned: count('planned'),
      gapped: count('gapped'),
      unplanned: count('unplanned'),
      dismissed: 0,
      untestable: untestable.length,
      orphanedAnchors: 0,
    },
  };
}
