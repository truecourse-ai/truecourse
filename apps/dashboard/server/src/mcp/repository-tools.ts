/**
 * The REPOSITORY's tools: its flows and their tests, its runs and their
 * failures, the coverage of its claims, and the dependencies its flows need —
 * plus the decisions the dashboard offers on them.
 *
 * Every tool names its repository, resolved through the dashboard's own
 * workspace scoping (`resolveRepo`), and reads through the same core drivers
 * the guard routes read through. The writes call the services the guard action
 * routes call.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  listGuardFlows,
  readGuardClaims,
  readGuardDecisions,
  readGuardEvidence,
  readGuardFlowDetail,
  readGuardHistory,
  readGuardRun,
  readGuardRunForView,
} from '@truecourse/core/commands/guard-read';
import type { GuardDependenciesView } from '@truecourse/core/commands/guard-dependencies';
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  guardCoveragePlainStatus,
  guardFlowPlainStatus,
  guardResultRunId,
  type GuardClaimCoverage,
  type GuardFlowDetail,
  type GuardLatest,
  type GuardScenarioResult,
} from '@truecourse/shared';
import { dismissFlow, undismissClaim, undismissFlow } from '../services/guard-decisions.service.js';
import {
  readRepoDependencies,
  registerRepoDependency,
} from '../services/guard-dependencies.service.js';
import { resolveRepo, run, ToolRefusal, type McpCaller } from './caller.js';

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

/** The run a tool names, or the latest; a refusal when there is none. */
async function runOf(repoPath: string, runId: string | undefined): Promise<GuardLatest> {
  const found = runId ? await readGuardRun(repoPath, runId) : await readGuardRunForView(repoPath);
  if (!found) {
    throw new ToolRefusal(
      runId ? `No run "${runId}" in this repository. list_runs names them.` : 'This repository has not run its tests yet.',
    );
  }
  return found;
}

/** One flow's detail, as a model reads it: the chain of claims and the tests behind it. */
function flowView(detail: GuardFlowDetail, dismissed: boolean) {
  return {
    flowId: detail.flowId,
    title: detail.title,
    goal: detail.goal,
    status: guardFlowPlainStatus({ status: detail.status, bucket: detail.bucket, findings: detail.findings.length }),
    dismissed,
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

/** The dependencies view with every value withheld: which are filled in, never what with. */
function dependenciesView(view: GuardDependenciesView) {
  return {
    ...(view.invalidReason ? { invalidReason: view.invalidReason } : {}),
    dependencies: view.dependencies.map((d) => ({
      name: d.name,
      class: d.class,
      summary: d.summary,
      requirement: d.requirement,
      ...(d.when ? { when: d.when } : {}),
      state: d.state,
      fields: d.fields.map((f) => ({
        field: f.field,
        filled: f.resolved,
        secret: f.secret,
        ...(f.description ? { description: f.description } : {}),
        ...(f.reason ? { reason: f.reason } : {}),
      })),
      ...(d.service
        ? {
            service: {
              services: d.service.services,
              baseUrlEnv: d.service.baseUrlEnv,
              baseUrlSet: d.service.baseUrl !== null,
              ...(d.service.mode ? { mode: d.service.mode } : {}),
              tokenSet: d.service.tokenSet,
              headers: d.service.headers.map((h) => h.name),
            },
          }
        : {}),
      usedBy: d.usedBy,
      blocks: d.blocks.map((b) => ({ ...(b.flowId ? { flowId: b.flowId } : {}), title: b.title, kind: b.kind })),
    })),
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
        const [view, decisions] = await Promise.all([listGuardFlows(repo.path), readGuardDecisions(repo.path)]);
        const dismissed = new Set(decisions.dismissedFlows.map((d) => d.flowId));
        const flows = view.flows
          .map((f) => ({
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
            ...(dismissed.has(f.flowId) ? { dismissed: true } : {}),
          }))
          .filter((f) => !args.status || args.status.includes(f.status));
        return {
          flows,
          dismissed: decisions.dismissedFlows.map((d) => ({ flowId: d.flowId, title: d.title, ...(d.note ? { note: d.note } : {}) })),
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
        const [detail, decisions] = await Promise.all([
          readGuardFlowDetail(repo.path, args.flowId),
          readGuardDecisions(repo.path),
        ]);
        if (!detail) throw new ToolRefusal(`No flow "${args.flowId}" in ${repo.name}. list_flows names them.`);
        return flowView(detail, decisions.dismissedFlows.some((d) => d.flowId === args.flowId));
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
        if (!args.dismissed) {
          const decisions = await undismissFlow(repo.path, { flowId: args.flowId });
          return { dismissedFlows: decisions.dismissedFlows };
        }
        const detail = await readGuardFlowDetail(repo.path, args.flowId);
        if (!detail) throw new ToolRefusal(`No flow "${args.flowId}" in ${repo.name}. list_flows names them.`);
        const decisions = await dismissFlow(
          { org, userId: caller.user.id, repoId: repo.slug },
          repo.path,
          { flowId: args.flowId, title: detail.title || args.flowId, ...(args.note ? { note: args.note } : {}) },
        );
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
        "One run's results, test by test: outcome (pass, fail, error, stale, orphaned, blocked), the document section the test proves, and the failing step's expected and actual. Without `runId`, the latest results.",
      inputSchema: { repo: repoArg, runId: z.string().optional() },
      annotations: READ,
    },
    (args) =>
      run('get_run', async () => {
        const repo = await resolveRepo(caller, args.repo);
        return runView(await runOf(repo.path, args.runId));
      }),
  );

  server.registerTool(
    'get_failures',
    {
      title: 'Get failures with evidence',
      description:
        "Every test that failed, errored or was blocked in a run (the latest without `runId`), each with its full failure detail, the adjudication when one was made, and the evidence transcript of what the test did. `testId` narrows to one test.",
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
        const latest = await runOf(repo.path, args.runId);
        const failed = latest.scenarios.filter(
          (s) =>
            (s.outcome === 'fail' || s.outcome === 'error' || s.outcome === 'blocked') &&
            (!args.testId || s.id === args.testId),
        );
        const failures = await Promise.all(
          failed.map(async (s) => {
            const runId = guardResultRunId(s, latest.run);
            const transcript = s.evidencePath ? await readGuardEvidence(repo.path, runId, s.id) : null;
            return {
              ...resultRow(s, latest),
              ...(s.failure ? { failure: s.failure } : {}),
              ...(s.adjudication ? { adjudication: s.adjudication } : {}),
              ...(s.blockedPrecondition ? { blockedPrecondition: true } : {}),
              evidence: transcript,
            };
          }),
        );
        return { runId: latest.run.runId, ranAt: latest.run.ranAt, failures };
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
        const view = await readGuardClaims(repo.path);
        const wanted = new Set<GuardClaimCoverage>(args.coverage ?? []);
        return {
          extracted: view.extracted,
          totals: view.totals,
          claims: view.claims
            .filter((c) => args.withFlow === undefined || c.flows.length > 0 === args.withFlow)
            .filter((c) => wanted.size === 0 || wanted.has(c.coverage))
            .map((c) => ({
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
        return dependenciesView(await readRepoDependencies(repo.path));
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
        return dependenciesView(await registerRepoDependency(org, repo.slug, repo.path, name, patch));
      }),
  );
}
