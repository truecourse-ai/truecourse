/**
 * The REPOSITORY's tools: its flows and their tests, its runs and their
 * failures, the coverage of its claims, and the dependencies its flows need —
 * plus the decisions the dashboard offers on them.
 *
 * Every tool names its repository, resolved through the dashboard's own
 * workspace scoping (`resolveRepo`), and calls the service or core read the
 * matching guard route calls.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readGuardHistory } from '@truecourse/core/commands/guard-read';
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GuardOutcomeSchema,
  guardCoveragePlainStatus,
  guardFlowPlainStatus,
  guardResultRunId,
  type GuardFlowDetail,
  type GuardLatest,
  type GuardScenarioResult,
} from '@truecourse/shared';
import { dismissFlow, undismissClaim, undismissFlow } from '../services/guard-decisions.service.js';
import {
  dependencyFillState,
  readRepoDependencies,
  registerRepoDependency,
} from '../services/guard-dependencies.service.js';
import {
  listRepoFlows,
  readRepoClaims,
  readRepoFlow,
  readRepoRun,
  readRepoRunFailures,
} from '../services/guard-reads.service.js';
import { resolveRepo, run, type McpCaller } from './caller.js';

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const repoArg = z
  .string()
  .describe('The repository: its id from list_repositories, or its `owner/repo` name.');

/** A run result row, as a model reads it. */
function resultRow(result: GuardScenarioResult, latest: GuardLatest) {
  return {
    testId: result.id,
    title: result.title,
    ...(result.flowId ? { flowId: result.flowId } : {}),
    outcome: result.outcome,
    doc: result.binds.doc,
    section: result.binds.section,
    runId: guardResultRunId(result, latest.run),
    ...(result.failure
      ? {
          failure: {
            step: result.failure.step,
            expected: result.failure.expected,
            actual: result.failure.actual,
          },
        }
      : {}),
    ...(result.failedMilestone ? { failedMilestone: result.failedMilestone } : {}),
    ...(result.blockedOn ? { blockedOn: result.blockedOn } : {}),
  };
}

/** A run snapshot, as a model reads it. */
function runView(latest: GuardLatest) {
  return {
    runId: latest.run.runId,
    ranAt: latest.run.ranAt,
    branch: latest.run.branch,
    commit: latest.run.commit,
    summary: latest.summary,
    tests: latest.scenarios.map((s) => resultRow(s, latest)),
  };
}

/** One flow's detail, as a model reads it: the chain of claims and the tests behind it. */
function flowView(detail: GuardFlowDetail) {
  return {
    flowId: detail.flowId,
    title: detail.title,
    goal: detail.goal,
    status: guardFlowPlainStatus({ status: detail.status, bucket: detail.bucket, findings: detail.findings.length }),
    dismissed: detail.dismissed,
    ...(detail.dismissalNote ? { dismissalNote: detail.dismissalNote } : {}),
    ...(detail.orphaned ? { orphaned: true, orphanedReason: detail.orphanedReason ?? null } : {}),
    steps: detail.milestones.map((m) => ({
      order: m.order,
      claim: m.claimTitle,
      doc: m.doc,
      section: m.anchor,
      ...(m.headingText ? { heading: m.headingText } : {}),
      ...(m.cases?.length ? { cases: m.cases.map((c) => c.claim) } : {}),
      ...(m.drifted ? { drifted: true } : {}),
      ...(m.live ? {} : { sectionGone: true }),
    })),
    tests: detail.surfaces.map((t) => ({
      ...(t.scenarioId ? { testId: t.scenarioId } : {}),
      ...(t.title ? { title: t.title } : {}),
      ...(t.surface ? { driver: t.surface } : {}),
      status: guardCoveragePlainStatus(t.status),
      ...(t.outcome ? { outcome: t.outcome } : {}),
      ...(t.stage ? { stage: t.stage } : {}),
      ...(t.runId ? { runId: t.runId } : {}),
      ...(t.failure
        ? { failure: { step: t.failure.step, expected: t.failure.expected, actual: t.failure.actual } }
        : {}),
      ...(t.triage ? { triage: t.triage } : {}),
      ...(t.gap ? { gap: t.gap } : {}),
    })),
    gaps: detail.gaps,
    generatedAt: detail.generatedAt,
    ranAt: detail.ranAt,
  };
}

export function registerRepositoryTools(server: McpServer, caller: McpCaller): void {
  const org = caller.org;

  server.registerTool(
    'list_flows',
    {
      title: 'List flows',
      description:
        "A repository's flows. A flow is one path a user takes through the product, derived from what the documents claim, and each has tests that prove it. `status` is one of failed, blocked, never-run, succeeded, not-testable. Filter by `status` to find, say, every failing flow.",
      inputSchema: {
        repo: repoArg,
        status: z.array(z.enum(GUARD_COVERAGE_PLAIN_ORDER)).optional(),
      },
      annotations: READ,
    },
    (args) =>
      run('list_flows', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const view = await listRepoFlows(repo.path, args.status ? { status: args.status } : {});
        return {
          flows: view.flows.map((f) => ({
            flowId: f.flowId,
            title: f.title,
            goal: f.goal,
            status: guardFlowPlainStatus(f),
            steps: f.milestoneCount,
            docs: f.docs,
            ...(f.drivers ? { drivers: f.drivers } : {}),
            ...(f.findings > 0 ? { findings: f.findings } : {}),
            ...(f.manual ? { manual: true } : {}),
            ...(f.epic ? { composedOf: f.composedOf } : {}),
            ...(f.dismissed ? { dismissed: true } : {}),
            ...(f.dismissalNote ? { dismissalNote: f.dismissalNote } : {}),
          })),
          generatedAt: view.generatedAt,
          ranAt: view.ranAt,
        };
      }),
  );

  server.registerTool(
    'get_flow',
    {
      title: 'Get a flow',
      description:
        'One flow: its goal, its steps (each the claim a document makes, with the document and section it comes from), and its tests with their latest status and failure.',
      inputSchema: { repo: repoArg, flowId: z.string() },
      annotations: READ,
    },
    (args) =>
      run('get_flow', async () => {
        const repo = await resolveRepo(caller, args.repo);
        return flowView(await readRepoFlow(repo.path, args.flowId));
      }),
  );

  server.registerTool(
    'set_flow_dismissed',
    {
      title: 'Dismiss or restore a flow',
      description:
        'Dismiss a flow (`dismissed: true`): the next Flow generation drops it and its tests, and it stops counting against coverage. `dismissed: false` restores it. A test cannot be dismissed on its own.',
      inputSchema: {
        repo: repoArg,
        flowId: z.string(),
        dismissed: z.boolean(),
        note: z.string().optional().describe('Why, in a sentence.'),
      },
      annotations: WRITE,
    },
    (args) =>
      run('set_flow_dismissed', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const decisions = args.dismissed
          ? await dismissFlow({ org, userId: caller.user.id, repoId: repo.slug }, repo.path, {
              flowId: args.flowId,
              ...(args.note ? { note: args.note } : {}),
            })
          : await undismissFlow(repo.path, { flowId: args.flowId });
        return { dismissedFlows: decisions.dismissedFlows };
      }),
  );

  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description: "A repository's test runs, newest first, each with its pass/fail summary.",
      inputSchema: { repo: repoArg },
      annotations: READ,
    },
    (args) =>
      run('list_runs', async () => {
        const repo = await resolveRepo(caller, args.repo);
        return readGuardHistory(repo.path, { all: true });
      }),
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get run results',
      description:
        "One run's results, test by test: outcome (pass, fail, error, stale, orphaned, blocked), the document section the test proves, and the failing step's expected and actual. Without `runId`, the latest results. `outcome` narrows the tests to those outcomes; the summary stays the whole run's. Ask for `blocked` to see the tests that never ran for want of a dependency: each carries `blockedOn`, the dependency to fill in (set_dependency_values) and what it must satisfy.",
      inputSchema: {
        repo: repoArg,
        runId: z.string().optional(),
        outcome: z.array(GuardOutcomeSchema).optional().describe('Only tests with one of these outcomes.'),
      },
      annotations: READ,
    },
    (args) =>
      run('get_run', async () => {
        const repo = await resolveRepo(caller, args.repo);
        return runView(
          await readRepoRun(repo.path, args.runId, args.outcome ? { outcome: args.outcome } : {}),
        );
      }),
  );

  server.registerTool(
    'get_failures',
    {
      title: 'Get failures with evidence',
      description:
        "Every test that failed or errored in a run (the latest without `runId`), each with its full failure detail, the adjudication when one was made, and the evidence transcript of what the test did. `testId` narrows to one test. A blocked test never ran; get_run shows what it was blocked on.",
      inputSchema: {
        repo: repoArg,
        runId: z.string().optional(),
        testId: z.string().optional(),
      },
      annotations: READ,
    },
    (args) =>
      run('get_failures', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const { run: latest, failures } = await readRepoRunFailures(repo.path, {
          ...(args.runId ? { runId: args.runId } : {}),
          ...(args.testId ? { testId: args.testId } : {}),
        });
        return {
          runId: latest.run.runId,
          ranAt: latest.run.ranAt,
          failures: failures.map(({ result, evidence }) => ({
            ...resultRow(result, latest),
            ...(result.failure ? { failure: result.failure } : {}),
            ...(result.adjudication ? { adjudication: result.adjudication } : {}),
            ...(result.blockedPrecondition ? { blockedPrecondition: true } : {}),
            evidence,
          })),
        };
      }),
  );

  server.registerTool(
    'get_coverage',
    {
      title: 'Get claim coverage',
      description:
        "What the repository's documents claim, and which claims a flow carries. Each claim's `coverage` is proven (a test passed), failing, planned (a flow carries it, not yet proven), gapped (deliberately in no flow, with the reason) or unplanned (in no flow, no reason). `withFlow: false` lists only the claims no flow carries.",
      inputSchema: {
        repo: repoArg,
        withFlow: z.boolean().optional().describe('true: only claims a flow carries; false: only claims none does.'),
        coverage: z.array(z.enum(['proven', 'failing', 'planned', 'gapped', 'unplanned'])).optional(),
      },
      annotations: READ,
    },
    (args) =>
      run('get_coverage', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const view = await readRepoClaims(repo.path, {
          ...(args.withFlow === undefined ? {} : { withFlow: args.withFlow }),
          ...(args.coverage ? { coverage: args.coverage } : {}),
        });
        return {
          extracted: view.extracted,
          totals: view.totals,
          claims: view.claims.map((c) => ({
            id: c.id,
            claim: c.claim,
            title: c.title,
            doc: c.doc,
            section: c.anchor,
            coverage: c.coverage,
            ...(c.gapReason ? { gapReason: c.gapReason } : {}),
            ...(c.dismissed ? { dismissed: true } : {}),
            flows: c.flows.map((f) => f.flowId),
          })),
        };
      }),
  );

  server.registerTool(
    'undismiss_claim',
    {
      title: 'Undo a claim dismissal',
      description:
        'Bring back a claim someone dismissed, so the next Flow generation covers it again. Name it the way get_coverage does: its `doc`, `section` and `title`.',
      inputSchema: { repo: repoArg, doc: z.string(), section: z.string(), title: z.string() },
      annotations: WRITE,
    },
    (args) =>
      run('undismiss_claim', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const decisions = await undismissClaim(repo.path, {
          doc: args.doc,
          anchor: args.section,
          title: args.title,
        });
        return { dismissedClaims: decisions.dismissedClaims };
      }),
  );

  server.registerTool(
    'list_dependencies',
    {
      title: 'List dependencies',
      description:
        "The starting state the repository's flows need to run — an account, an API key, a third-party service — and whether each is filled in. Values are never returned, only `filled` per field. A dependency that is not filled in blocks the flows in its `blocks`.",
      inputSchema: { repo: repoArg },
      annotations: READ,
    },
    (args) =>
      run('list_dependencies', async () => {
        const repo = await resolveRepo(caller, args.repo);
        return dependencyFillState(await readRepoDependencies(repo.path));
      }),
  );

  server.registerTool(
    'set_dependency_values',
    {
      title: 'Fill in a dependency',
      description:
        "Enter the connection values of one dependency from list_dependencies: `env` sets its declared variables (null clears one); for a third-party service, `baseUrl`, `mode`, `token` and `headers`. Only variables the dependency declares are accepted. Values are stored encrypted and never returned; the answer says what is now filled in.",
      inputSchema: {
        repo: repoArg,
        name: z.string().describe('The dependency name from list_dependencies.'),
        env: z.record(z.string().nullable()).optional(),
        baseUrl: z.string().optional(),
        mode: z.enum(['sandbox', 'real']).optional(),
        token: z.string().nullable().optional(),
        headers: z.record(z.string().nullable()).optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      run('set_dependency_values', async () => {
        const repo = await resolveRepo(caller, args.repo);
        const { repo: _repo, name, ...patch } = args;
        return dependencyFillState(await registerRepoDependency(org, repo.slug, repo.path, name, patch));
      }),
  );
}
