/**
 * The acme corpus (./corpus.ts) folded into the EXACT payload shapes the real
 * coverage components consume, so the Coverage tab renders the existing
 * `SpecCorpusView` / `GuardCoveragePage` / `SpecOverlapDetail` / `SpecDocViewer`
 * unchanged over fake data:
 *
 *   - `SpecCorpusResponse` (the corpus endpoint): docs, areas with overlaps,
 *     skipped docs, the recorded conflict verdicts;
 *   - one markdown body per doc (the doc endpoint), whose headings are the
 *     sections the coverage is joined to;
 *   - one `GuardDocCoverage` per doc (the per-doc coverage endpoint): sections in
 *     document order, each with its status and the flows that traverse it;
 *   - the staleness probe.
 *
 * Anchors and alignment follow the real rules: a section anchor is the slug
 * path of its heading chain, and the client aligns coverage to the rendered doc
 * by heading text and level in order.
 */

import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_DRIVERS,
  emptyGapDisplayTotals,
  guardCoveragePlainStatus,
  guardFlowPlainStatus,
} from '@/preview/vendor/shared';
import type {
  GuardCoveragePlainStatus,
  GuardCoverageSummary,
  GuardDocCoverage,
  GuardDriverId,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
  GuardSectionFlow,
  GuardStaleness,
  GuardStatusSummary,
} from '@/preview/vendor/shared';
import type { SpecCorpusArea, SpecCorpusDoc, SpecCorpusResponse, SpecOverlap } from '@/preview/vendor/lib/api';
import {
  conflictsAtVersion,
  conflictsForRepo,
  coverageVersionById,
  coverageVersions,
  docsAtVersion,
  docsForRepo,
  type SpecConflict,
  type SpecDoc,
  type SpecSection,
} from './corpus';
import {
  COVERAGE_STATUS,
  GENERATED_AT,
  fakeFingerprint as fingerprint,
  flowIdFor,
  flowSurfaceFor,
  flowsView,
  scenarioIdFor,
  sectionAnchor,
  slugify,
  testSurface,
} from './flow-fixtures';
import { latestRun } from './run-fixtures';
import { REPO_GUARD } from './index';

const SECTION_INTRO: Record<string, string> = {
  passing: 'Every claim below is proven by the scenarios that traverse this section.',
  failing: 'At least one claim below failed on the last run; the failing scenario names the step.',
  blocked: 'The scenarios for this section cannot run until their dependency is supplied.',
  'not-testable': 'The claims below name a condition no sandbox can arrange.',
  'never-run': 'Scenarios exist for this section but no run has executed them yet.',
};

/** The doc's markdown: one H1, one H2 per section, two or three claim sentences each. */
export function docMarkdown(doc: SpecDoc): string {
  const lines: string[] = [`# ${doc.title}`, '', `What ${doc.title.toLowerCase()} promises, as the product states it.`, ''];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`, '');
    lines.push(SECTION_INTRO[s.status] ?? '');
    lines.push('');
    for (let i = 0; i < s.claims; i++) {
      lines.push(`- ${claimSentence(doc, s, i)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function claimSentence(doc: SpecDoc, s: SpecSection, i: number): string {
  const stems = [
    `${s.heading} is refused when the input is missing a required field.`,
    `${s.heading} records who acted and when, and the record is readable afterwards.`,
    `${s.heading} completes within the documented window, or reports why not.`,
    `${s.heading} never changes state on a failed request.`,
  ];
  return stems[i % stems.length]!.replace(/^./, (c) => c.toUpperCase()) + (i === 0 ? ` (${doc.area})` : '');
}

/**
 * The flows that traverse a section, the same flow ids, statuses and surface
 * rows the Tests tab lists, so a section's flow row opens a flow that exists.
 */
function sectionCoverage(repoId: string, doc: SpecDoc, s: SpecSection, anchor: string): GuardSectionCoverage {
  const guard = REPO_GUARD[repoId];
  const tests = s.tests
    .map((testId) => guard?.tests.find((t) => t.id === testId))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const flows: GuardSectionFlow[] = tests.map((t) => ({
    flowId: flowIdFor(t),
    title: t.flow,
    status: COVERAGE_STATUS[t.status],
    reason: t.reason,
    epic: false,
    manual: false,
    milestonesInSection: [1],
    milestoneCount: Math.max(1, t.steps.length),
    surfaces: [flowSurfaceFor(repoId, t)],
  }));
  const status: GuardSectionCoverageStatus = s.tests.length === 0 ? 'unguarded' : COVERAGE_STATUS[s.status];
  return {
    anchor,
    headingText: s.heading,
    level: 2,
    fingerprint: fingerprint(doc.path + s.heading),
    status,
    reason: s.reason,
    flows,
    // Every claim a section states is carried by one of its flows in this board,
    // so no section has a claim-level gap of its own.
    claimGaps: [],
    scenarioIds: tests.map((t) => scenarioIdFor(repoId, t)).filter((id): id is string => id !== null),
    scenarios: [],
  };
}

const ALL_STATUSES: GuardSectionCoverageStatus[] = [
  'fail', 'error', 'stale', 'orphaned', 'pass', 'guarded', 'authoring-error', 'needs-setup', 'blocked-on',
  'unrealizable', 'no-interface', 'web', 'tui', 'library', 'desktop', 'mobile', 'untestable', 'no-claim',
  'dismissed', 'unguarded', 'blocked', 'never-run',
];

export function docCoverage(repoId: string, doc: SpecDoc): GuardDocCoverage {
  const top = slugify(doc.title);
  const sections: GuardSectionCoverage[] = [
    {
      anchor: top,
      headingText: doc.title,
      level: 1,
      fingerprint: fingerprint(doc.path),
      status: 'no-claim',
      flows: [],
      claimGaps: [],
      scenarioIds: [],
      scenarios: [],
    },
    ...doc.sections.map((s) => sectionCoverage(repoId, doc, s, sectionAnchor(doc, s))),
  ];
  const totals = Object.fromEntries(ALL_STATUSES.map((k) => [k, 0])) as Record<GuardSectionCoverageStatus, number>;
  for (const s of sections) totals[s.status] += 1;
  const latestRun = REPO_GUARD[repoId]?.runs[0];
  return {
    doc: doc.path,
    markdown: true,
    sections,
    orphanedSections: [],
    totals,
    runId: latestRun?.id ?? null,
    ranAt: latestRun ? '2026-08-21T13:20:00.000Z' : null,
    generatedAt: '2026-08-21T11:05:00.000Z',
  };
}

function overlapFor(conflict: SpecConflict, docs: SpecDoc[], areaId: string): SpecOverlap {
  const refOf = (docId: string) => docs.find((d) => d.id === docId)?.path ?? docId;
  const [a, b] = conflict.sides;
  return {
    docs: [refOf(a!.docId), refOf(b!.docId)],
    note: conflict.title,
    review: {
      explanation: `${a!.claim} The other section states: ${b!.claim}`,
      recommendation: {
        action: conflict.recommendation.side === 0 ? 'pick-a' : 'pick-b',
        rationale: conflict.recommendation.why,
      },
    },
    sections: [
      { doc: refOf(a!.docId), heading: a!.section, quote: a!.claim },
      { doc: refOf(b!.docId), heading: b!.section, quote: b!.claim },
    ],
    areas: [areaId],
  };
}

function areaId(repoId: string, area: string): string {
  return `${repoId.replace(/-api$/, '')}/${slugify(area)}`;
}

export function corpusResponse(repoId: string, versionId?: string | null): SpecCorpusResponse | null {
  const version = coverageVersionById(repoId, versionId);
  const docs = docsAtVersion(repoId, version);
  if (docs.length === 0) return null;
  const conflicts = conflictsAtVersion(repoId, version);
  const areas = [...new Set(docs.map((d) => d.area))];

  const corpusDocs: SpecCorpusDoc[] = docs.map((d) => ({
    ref: d.path,
    kind: 'spec',
    lastTouched: '2026-08-19T09:14:00.000Z',
    areaTags: [areaId(repoId, d.area)],
    ...(d.origin === 'site'
      ? { origin: 'web' as const, sourceId: 'stripe-docs', sourceTitle: 'Stripe docs', url: 'https://docs.stripe.com/refunds' }
      : {}),
  }));

  const corpusAreas: SpecCorpusArea[] = areas.map((area) => ({
    id: areaId(repoId, area),
    product: repoId.replace(/-api$/, ''),
    concern: slugify(area),
    docRefs: docs.filter((d) => d.area === area).map((d) => d.path),
    overlaps: conflicts.filter((c) => c.area === area).map((c) => overlapFor(c, docs, areaId(repoId, area))),
  }));

  const resolved = conflicts.filter((c) => c.status === 'resolved');
  const refOf = (docId: string) => docs.find((d) => d.id === docId)?.path ?? docId;

  const versionInfo = version
    ? {
        id: version.id,
        label: version.label,
        parentId: version.parentId,
        ref: version.ref,
        sha: version.sha,
        ...(version.pullRequest != null ? { pullRequest: version.pullRequest } : {}),
        generated: version.generated,
        docChanges: Object.fromEntries(
          version.changes.docs.map((c) => [c.ref, { change: c.change, ...(c.sections ? { sections: c.sections } : {}) }]),
        ),
        conflictChanges: Object.fromEntries(
          version.changes.conflicts.flatMap((c) => {
            const conflict = conflicts.find((x) => x.id === c.id);
            if (!conflict) return [];
            const refOf = (docId: string) => docs.find((d) => d.id === docId)?.path ?? docId;
            const key = `overlap::${areaId(repoId, conflict.area)}::${refOf(conflict.sides[0]!.docId)}::${refOf(conflict.sides[1]!.docId)}`;
            return [[key, c.change]];
          }),
        ),
      }
    : undefined;

  return {
    ...(versionInfo ? { version: versionInfo } : {}),
    corpus: {
      version: 3,
      generatedAt: '2026-08-21T11:02:00.000Z',
      docs: corpusDocs,
      areas: corpusAreas,
      skippedDocs: [
        { ref: 'CHANGELOG.md', reason: 'release notes, not a specification' },
        { ref: 'docs/internal/oncall-runbook.md', reason: 'operations, not product behavior' },
        { ref: 'README.md', reason: 'setup instructions only' },
      ],
    },
    manualIncludes: [],
    manualExcludes: [],
    conflictResolutions: resolved.map((c) => ({
      docA: refOf(c.sides[0]!.docId),
      anchorA: `${slugify(docs.find((d) => d.id === c.sides[0]!.docId)?.title ?? '')}/${slugify(c.sides[0]!.section)}`,
      quoteA: c.sides[0]!.claim,
      docB: refOf(c.sides[1]!.docId),
      anchorB: `${slugify(docs.find((d) => d.id === c.sides[1]!.docId)?.title ?? '')}/${slugify(c.sides[1]!.section)}`,
      quoteB: c.sides[1]!.claim,
      verdict: c.recommendation.side === 0 ? 'a' : 'b',
      resolvedAt: '2026-08-20T16:40:00.000Z',
      note: c.resolution,
    })),
  };
}

export function docByRef(repoId: string, ref: string): SpecDoc | undefined {
  const base = docsForRepo(repoId).find((d) => d.path === ref);
  if (base) return base;
  // A document a pull request's version added exists only at that version.
  for (const v of coverageVersions(repoId)) {
    const hit = docsAtVersion(repoId, v).find((d) => d.path === ref);
    if (hit) return hit;
  }
  return undefined;
}

export function stalenessFor(repoId: string): GuardStaleness {
  const guard = REPO_GUARD[repoId];
  return {
    generateStale: false,
    runStale: repoId === 'web-console',
    hasCorpus: docsForRepo(repoId).length > 0,
    hasScenarios: Boolean(guard && guard.tests.length > 0),
    hasGenerated: Boolean(guard && guard.tests.length > 0),
    hasRun: Boolean(guard && guard.runs.length > 0),
  };
}

// ---------------------------------------------------------------------------
// The compact status summary the coverage overview leads with, composed from
// the same board every other fixture reads, so the bars, the flow tally and the
// freshness lines can never disagree with the tabs they summarize.
// ---------------------------------------------------------------------------

function zeroPlain(): Record<GuardCoveragePlainStatus, number> {
  return Object.fromEntries(GUARD_COVERAGE_PLAIN_ORDER.map((k) => [k, 0])) as Record<
    GuardCoveragePlainStatus,
    number
  >;
}

/** Per-driver classification of the sections, plus the two residual buckets. */
function classify(repoId: string): GuardCoverageSummary['classification'] {
  const out = Object.fromEntries(GUARD_DRIVERS.map((d) => [d.id, 0])) as Record<GuardDriverId, number>;
  const classification = { ...out, untestable: 0, unclassified: 0 };
  for (const doc of docsForRepo(repoId)) {
    for (const section of doc.sections) {
      const test = REPO_GUARD[repoId]?.tests.find((t) => section.tests.includes(t.id));
      if (!test) classification.unclassified += 1;
      else if (test.status === 'not-testable') classification.untestable += 1;
      else classification[testSurface(test)] += 1;
    }
  }
  return classification;
}

export function statusSummary(repoId: string): GuardStatusSummary {
  const docs = docsForRepo(repoId);
  if (docs.length === 0) return { coverage: null, sections: null, lastRun: null, lastGenerate: null };
  const sections = docs.flatMap((d) => d.sections);
  const view = flowsView(repoId);
  const run = latestRun(repoId);

  const sectionsByStatus = zeroPlain();
  for (const section of sections) {
    const test = REPO_GUARD[repoId]?.tests.find((t) => section.tests.includes(t.id));
    const status = test ? guardCoveragePlainStatus(COVERAGE_STATUS[test.status]) : 'blocked';
    sectionsByStatus[status] += 1;
  }

  const flowsByStatus = zeroPlain();
  for (const flow of view.flows) flowsByStatus[guardFlowPlainStatus(flow)] += 1;

  const tests = REPO_GUARD[repoId]?.tests ?? [];
  return {
    coverage: {
      totalSections: sections.length,
      withScenarios: sections.filter((s) => s.tests.length > 0).length,
      classification: classify(repoId),
      byStatus: sectionsByStatus,
      flows: {
        total: view.totals.total,
        guarded: view.totals.guarded,
        partial: view.totals.partial,
        blocked: view.totals.blocked,
        gapLabels: [],
        byStatus: flowsByStatus,
      },
    },
    sections: { total: sections.length, byStatus: sectionsByStatus },
    lastRun: run
      ? { ranAt: run.run.ranAt, branch: run.run.branch, commit: run.run.commit, summary: run.summary }
      : null,
    lastGenerate: {
      generatedAt: GENERATED_AT,
      status: 'ok',
      noChanges: true,
      written: 0,
      testsPassing: tests.filter((t) => t.status === 'passing').length,
      testsFailing: tests.filter((t) => t.status === 'failing').length,
      testsNeverRun: tests.filter((t) => t.status === 'never-run').length,
      birthPassed: null,
      coverageGapsByKind: emptyGapDisplayTotals(),
      blockedOnCapabilities: {},
      birthFindings: 0,
      fidelityRejections: 0,
      errors: 0,
      readyButHeld: 0,
      heldByFindings: 0,
      heldByErrors: 0,
      llmFailures: [],
      unadjudicated: [],
    },
  };
}
