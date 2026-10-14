/**
 * What a pull request's check needs from the chain that carries it. The check
 * is the main chain's own links (setup → generate → run) working the head
 * under the pull request's scope; this module is how a link tells the check it
 * started, how the link that ends the chain settles it, and what the run is
 * compared with.
 *
 * The check's row holds the first half of its report from the moment the
 * coordinator (`repo.pr-check`) hands over: the base, the documents it scanned,
 * the conflicts the head creates. The link that settles merges its own half in.
 * A link whose check is already settled (a newer head superseded it, the pull
 * request closed) does nothing: its row keeps the first word. A link the
 * balance paused leaves its check open, so its resume carries the same check on.
 * A link someone cancelled settles its check `cancelled`, unless the cancel was
 * a supersede, which settled it first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '@truecourse/core/lib/logger';
import {
  forEachScenarioFile,
  readGuardRunFlows,
  readGuardRunForCommit,
  readManifest,
} from '@truecourse/core/lib/guard-store';
import {
  readFlowTestRecords,
  readGuardFlowsFile,
  readGuardRunFlowSummary,
  readGuardRunFlowSummaryFromTree,
  readTreeFlowTestRecords,
} from '@truecourse/core/commands/guard-read';
import { parseContextDocRef } from '@truecourse/core/lib/context-ref';
import { compareFlows, docsMoved, proven, testsRewritten, type FlowBindings } from '@truecourse/core/services/pr-check/compare';
import { PAUSED_CHECK_OUTPUT, renderCheckOutput, updateCheck, type OctokitClient } from '@truecourse/github-app';
import {
  isWorldBootFailure,
  readGuardFlowsCorpus,
  readManifest as readTreeManifest,
  type RunGuardResult,
} from '@truecourse/guard-runner';
import {
  CHECK_CONCLUSION_OF_REASON,
  parseDocTree,
  sentencesByKey,
  type DocTree,
  type FlowTestCopyDrift,
  type FlowTestRecord,
  type GuardFlow,
  type GuardFlowsFile,
  type GuardLatest,
  type GuardManifest,
  type GuardRunFlowSummary,
  type PullRequestCheckConclusion,
  type PullRequestCheckReason,
  type PullRequestCheckRecord,
  type PullRequestCheckReport,
  type PullRequestDocSentence,
  type PullRequestStore,
} from '@truecourse/shared';
import { flowTestsDir } from '@truecourse/shared/work-tree';
import type { PullRequestLink } from './tasks/onboarding.js';

/** What the links reach the check through. */
export interface PullRequestCheckPort {
  pulls: PullRequestStore;
  /** An installation-scoped GitHub client. */
  octokitFor: (installationId: number) => OctokitClient;
  /** Where the product is served, for the check's details link. */
  appUrl: string;
}

/** What settling a check writes through: its row, and GitHub's check. */
export type CheckWriter = Pick<PullRequestCheckPort, 'pulls' | 'octokitFor'>;

/** Where a check's link points: the record of the link it stopped in, or the run it settled on. */
export const checkLinks = {
  record: (appUrl: string, runId: string): string => `${appUrl}/agent/${runId}`,
  run: (appUrl: string, slug: string, guardRunId: string): string =>
    `${appUrl}/repos/${slug}/runs/${encodeURIComponent(guardRunId)}`,
  runs: (appUrl: string, slug: string): string => `${appUrl}/repos/${slug}/runs`,
  conflicts: (appUrl: string, repoFullName: string, number: number): string =>
    `${appUrl}/context/conflicts?pr=${encodeURIComponent(`${repoFullName}#${number}`)}`,
};

/** How a check settles: its reason, the report's half this settle adds, and the run it settled on. */
export interface CheckOutcome {
  reason: PullRequestCheckReason;
  /** Defaults to the reason's conclusion; a conflict only the base had is neutral. */
  conclusion?: PullRequestCheckConclusion;
  report?: Partial<PullRequestCheckReport>;
  guardRunId?: string | null;
}

/** Move GitHub's check, when one was posted. A GitHub that refuses is logged, never the check's failure. */
export async function postCheck(
  octokit: OctokitClient,
  check: PullRequestCheckRecord,
  input: Parameters<typeof updateCheck>[3],
): Promise<void> {
  if (check.githubCheckRunId === null) return;
  try {
    await updateCheck(octokit, check.repoFullName, check.githubCheckRunId, input);
  } catch (err) {
    log.warn(`[jobs] could not update GitHub's check for ${check.repoFullName}#${check.number}: ${(err as Error).message}`);
  }
}

/**
 * A link of the check's chain started: the row names its job (what a
 * supersede stops) and GitHub's check points at it. False when the check is
 * already settled, and the link then does nothing: the write itself refuses a
 * settled row, so a supersede landing between the read and the write wins.
 */
export async function linkStarted(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  jobId: string,
  detailsUrl: string,
  what: string,
): Promise<boolean> {
  const check = await port.pulls.getCheck(link.checkId);
  if (!check || check.status === 'settled') return false;
  const started = await port.pulls.updateCheck(check.id, {
    status: 'running',
    jobId,
    ...(check.startedAt ? {} : { startedAt: new Date().toISOString() }),
  });
  if (!started) return false;
  await postCheck(port.octokitFor(link.installationId), started, {
    status: 'in_progress',
    detailsUrl,
    output: { title: 'Checking', summary: what },
  });
  return true;
}

/** Whether the check a link works for is still open. */
export async function checkIsOpen(port: PullRequestCheckPort, link: PullRequestLink): Promise<boolean> {
  const check = await port.pulls.getCheck(link.checkId);
  return check !== null && check.status !== 'settled';
}

/**
 * Settle a check and move GitHub's check with it: the one transition to
 * `settled`, whoever takes it. The report's half this settle adds is merged
 * over the half its row holds; an outcome with no report of its own (a
 * supersede, a cancel) says so on GitHub without one. A row settled meanwhile
 * keeps its word, GitHub is not told twice, and the answer is null. GitHub is
 * not told at all without an installation to tell it through.
 */
export async function settleCheck(
  port: CheckWriter,
  checkId: string,
  installationId: number | null,
  outcome: CheckOutcome,
  detailsUrl: string | null,
): Promise<PullRequestCheckRecord | null> {
  const current = await port.pulls.getCheck(checkId);
  if (!current) return null;
  const report = outcome.report ? ({ ...current.report, ...outcome.report } as PullRequestCheckReport) : null;
  const conclusion = outcome.conclusion ?? CHECK_CONCLUSION_OF_REASON[outcome.reason];
  const settled = await port.pulls.settleCheck(checkId, {
    conclusion,
    reason: outcome.reason,
    ...(report ? { report } : {}),
    ...(outcome.guardRunId ? { guardRunId: outcome.guardRunId } : {}),
  });
  if (!settled) {
    log.info(`[jobs] check ${checkId} of ${current.repoFullName}#${current.number} was settled before it could be: ${outcome.reason} not recorded`);
    return null;
  }
  if (installationId !== null) {
    await postCheck(port.octokitFor(installationId), settled, {
      status: 'completed',
      reason: outcome.reason,
      conclusion,
      ...(detailsUrl ? { detailsUrl } : {}),
      output: renderCheckOutput(outcome.reason, report, detailsUrl),
    });
  }
  return settled;
}

/**
 * The balance paused the job a check waits on. The check stays open: the
 * resumed job carries it on, and a newer head, a close or a draft settles it
 * meanwhile as it settles any open check. GitHub's check says why it waits.
 */
export async function pauseCheck(
  port: PullRequestCheckPort,
  check: PullRequestCheckRecord,
  installationId: number,
  detailsUrl: string | null,
): Promise<void> {
  await postCheck(port.octokitFor(installationId), check, {
    status: 'in_progress',
    ...(detailsUrl ? { detailsUrl } : {}),
    output: PAUSED_CHECK_OUTPUT,
  });
}

/** Mark the check a link works for paused; nothing when its row is gone or settled. */
export async function pauseLinkCheck(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  detailsUrl: string | null,
): Promise<void> {
  try {
    const check = await port.pulls.getCheck(link.checkId);
    if (check && check.status !== 'settled') await pauseCheck(port, check, link.installationId, detailsUrl);
  } catch (err) {
    log.warn(`[jobs] could not mark check ${link.checkId} paused: ${(err as Error).message}`);
  }
}

/** Settle the check a link works for; never throws. */
export async function settleLinkCheck(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  outcome: CheckOutcome,
  detailsUrl: string | null,
): Promise<void> {
  try {
    await settleCheck(port, link.checkId, link.installationId, outcome, detailsUrl);
  } catch (err) {
    log.warn(`[jobs] could not settle check ${link.checkId}: ${(err as Error).message}`);
  }
}

/**
 * Settle a check whose chain ended with nothing to run (the repository reads
 * no documents): on the spec half alone, as the coordinator would have. A
 * conflict the head created, already on the row, fails it and links to them.
 */
export async function settleWithoutRun(
  port: PullRequestCheckPort,
  repoFullName: string,
  link: PullRequestLink,
  detailsUrl: string | null,
): Promise<void> {
  const check = await port.pulls.getCheck(link.checkId);
  const conflicted = (check?.report?.conflictsCreated.length ?? 0) > 0;
  await settleLinkCheck(
    port,
    link,
    { reason: conflicted ? 'conflict' : 'clean', report: { codeHalf: 'not-run' } },
    conflicted ? checkLinks.conflicts(port.appUrl, repoFullName, link.number) : detailsUrl,
  );
}

/** A run that could not start: the head does not build, seed or boot. */
export function buildFailed(result: Exclude<RunGuardResult, { status: 'ok' }>): boolean {
  return (
    result.status === 'build-failed' ||
    result.status === 'entry-preflight-failed' ||
    result.status === 'seed-failed'
  );
}

/** Every scenario met a world that never came up, and none ran at all. */
export function worldNeverBooted(latest: GuardLatest): boolean {
  if (latest.scenarios.length === 0) return false;
  const ran = latest.scenarios.some((s) => s.outcome === 'pass' || s.outcome === 'fail');
  return !ran && latest.scenarios.some(isWorldBootFailure);
}

/**
 * The head's flows as its run left them, read from the head's tree. A flow
 * test whose seed did not hold at the head could not run there, so its flow
 * reads blocked, where a run of the default branch keeps the status it was
 * accepted on.
 */
export function headFlowSummary(treeDir: string, latest: GuardLatest): GuardRunFlowSummary {
  const flows = readGuardRunFlowSummaryFromTree(treeDir, latest) ?? {};
  for (const id of seedFailedFlows(latest)) if (id in flows) flows[id] = 'blocked';
  return flows;
}

const seedFailedFlows = (latest: GuardLatest): Set<string> =>
  new Set((latest.flowTests ?? []).filter((t) => t.outcome === 'seed-failed').map((t) => t.flowId));

/**
 * The head's run compared flow by flow with the base's, and the documents the
 * head moved under its flows: the run's half of the report and the reason it
 * settles on. A new failure fails the check; else a conflict the head created
 * (already on the row) does; else it is clean. A run of flow tests also lists
 * the tests the head rewrote to keep passing.
 */
export async function compareWithBase(input: {
  repoFullName: string;
  link: PullRequestLink;
  treeDir: string;
  latest: GuardLatest;
  headFlows: GuardRunFlowSummary;
  conflictsCreated: number;
  /** An earlier run of the same commit (generate's own run of the tests), whose passes mark a failure as possibly flaky. */
  earlier?: GuardLatest | null;
}): Promise<CheckOutcome> {
  const { repoFullName, link, treeDir, latest } = input;
  const flowTests = latest.flowTests !== undefined;
  const baseRun = await readGuardRunForCommit(repoFullName, link.baseCommit);
  const baseFlows = baseRun ? await baseFlowSummary(repoFullName, baseRun) : {};
  const deltas = compareFlows(baseFlows, input.headFlows);
  const flows = new Map((readGuardFlowsCorpus(treeDir)?.flows ?? []).map((f) => [f.id, f]));
  const titles = new Map([...flows.values()].map((f) => [f.id, f.title]));
  const of = (kind: (typeof deltas)[number]['kind']) =>
    deltas.filter((d) => d.kind === kind).map((d) => ({ id: d.flowId, title: titles.get(d.flowId) ?? d.flowId }));
  const headManifest = readTreeManifest(treeDir);
  const headTests = flowTests ? [...readTreeFlowTestRecords(treeDir).values()] : [];
  // What a new failure names: its scenarios, or its flow test's spec.
  const runOf: Map<string, string[]> = flowTests
    ? new Map(headTests.flatMap((t) => (t.file ? [[t.flowId, [t.file]]] : [])))
    : scenarioIdsByFlow(headManifest);
  const headTestOf = new Map(headTests.map((t) => [t.flowId, t]));
  const newFailures = of('new-failure').map((f) => ({
    ...f,
    scenarioIds: runOf.get(f.id) ?? [],
    ...(flowTests ? failureDetail(treeDir, f.id, flows.get(f.id), headTestOf.get(f.id), latest, input.earlier ?? null) : {}),
  }));
  const seedFailed = seedFailedFlows(latest);
  const rewritten = flowTests
    ? testsRewritten(deltas, await storedFlowTestSources(repoFullName, link.baseCommit), treeFlowTestSources(treeDir, headTests))
    : [];
  const run: NonNullable<PullRequestCheckReport['run']> = {
    runId: latest.run.runId,
    counts: {
      newFailures: newFailures.length,
      preExisting: of('pre-existing').length,
      fixed: of('fixed').length,
      newlyBlocked: of('newly-blocked').length,
      newlyCovered: of('newly-covered').length,
      added: of('added').length,
      retired: of('retired').length,
      held: Object.values(input.headFlows).filter(proven).length,
    },
    newFailures,
    preExisting: of('pre-existing'),
    fixed: of('fixed'),
    newlyBlocked: of('newly-blocked').map((f) => ({
      ...f,
      why: link.fork
        ? 'the registered instances are not provided to a fork'
        : seedFailed.has(f.id)
          ? 'its seed did not hold at the head'
          : 'could not run at the head',
    })),
    newlyCovered: of('newly-covered'),
    rewritten: rewritten.map((id) => ({
      id,
      title: titles.get(id) ?? id,
      copyDrift: renames(treeDir, flows.get(id), headTestOf.get(id)?.copyDrift ?? []),
    })),
  };
  // Scenarios bind through the manifest; flow tests through the flow corpus.
  const [baseBindings, headBindings] = flowTests
    ? [corpusBindings(await readGuardFlowsFile(repoFullName, link.baseCommit)), corpusBindings(readGuardFlowsCorpus(treeDir))]
    : [(await readManifest(repoFullName, { commitSha: link.baseCommit }))?.flows ?? [], headManifest?.flows ?? []];
  const moved = docsMoved(baseBindings, headBindings).map((d) => ({
    doc: parseContextDocRef(d.doc)?.docPath ?? d.doc,
    flows: d.flowIds.map((id) => ({ id, title: titles.get(id) ?? id })),
  }));
  const reason: PullRequestCheckReason =
    newFailures.length > 0 ? 'new-failures' : input.conflictsCreated > 0 ? 'conflict' : 'clean';
  return { reason, report: { docsMoved: moved, run, codeHalf: 'ran' }, guardRunId: latest.run.runId };
}

/** The base run's flows as stored beside it, else derived from its snapshot. */
async function baseFlowSummary(repoFullName: string, run: GuardLatest): Promise<GuardRunFlowSummary> {
  const stored = await readGuardRunFlows(repoFullName, run.run.runId);
  if (stored && Object.keys(stored).length > 0) return stored;
  return (await readGuardRunFlowSummary(repoFullName, run)) ?? {};
}

function scenarioIdsByFlow(manifest: GuardManifest | null): Map<string, string[]> {
  return new Map((manifest?.flows ?? []).map((f) => [f.flowId, f.scenarios.map((s) => s.id)]));
}

const corpusBindings = (corpus: GuardFlowsFile | null): FlowBindings[] =>
  (corpus?.flows ?? []).map((f) => ({ flowId: f.id, bindings: f.bindings }));

/** One flow's test sources as one string: its spec, then its seed. */
const testSource = (spec: string | null, seed: string | null): string => `${spec ?? ''}\0${seed ?? ''}`;

/** Each flow test's sources in the head's tree, by flow id. */
function treeFlowTestSources(treeDir: string, tests: readonly FlowTestRecord[]): Map<string, string> {
  const read = (file: string | undefined): string | null => {
    const abs = file ? path.join(flowTestsDir(treeDir), file) : null;
    return abs && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
  };
  return new Map(tests.flatMap((t) => (t.file ? [[t.flowId, testSource(read(t.file), read(t.seed))] as const] : [])));
}

/** Each flow test's sources in the set stored at `commit`, by flow id. */
async function storedFlowTestSources(repoFullName: string, commit: string): Promise<Map<string, string>> {
  const tests = [...(await readFlowTestRecords(repoFullName, commit)).values()];
  // Store paths are tree-relative; any root spells them the same.
  const fileRel = (file: string): string =>
    path.relative(repoFullName, path.join(flowTestsDir(repoFullName), file)).split(path.sep).join('/');
  const bodies = new Map<string, string>();
  const files = tests.flatMap((t) => [t.file, t.seed]).flatMap((f) => (f ? [fileRel(f)] : []));
  await forEachScenarioFile(repoFullName, files, { commitSha: commit }, (rel, body) => {
    bodies.set(rel, body);
  });
  const body = (file: string | undefined): string | null => (file ? (bodies.get(fileRel(file)) ?? null) : null);
  return new Map(tests.flatMap((t) => (t.file ? [[t.flowId, testSource(body(t.file), body(t.seed))] as const] : [])));
}

/**
 * What a developer needs to see of one new failure of a flow test: the step it
 * failed at, the documented sentence that step proves, what the product did
 * instead, and how long before an earlier run of the same commit passed it.
 */
function failureDetail(
  treeDir: string,
  flowId: string,
  flow: GuardFlow | undefined,
  record: FlowTestRecord | undefined,
  latest: GuardLatest,
  earlier: GuardLatest | null,
): Pick<NonNullable<PullRequestCheckReport['run']>['newFailures'][number], 'step' | 'documented' | 'observed' | 'passedEarlierSeconds'> {
  const ran = latest.flowTests?.find((t) => t.flowId === flowId);
  const steps = ran?.run.steps ?? [];
  const failed = steps.find((step) => step.outcome === 'failed');
  const documented = failed ? milestoneSentence(treeDir, flow, failed.order) : null;
  // A test accepted failing at the head says in its own words what the product does; a test that
  // was passing only has its assertion.
  const observed = record?.status === 'failing' && record.disagreement ? record.disagreement.observed : assertionOf(ran?.run.error);
  const passedEarlier = earlier?.flowTests?.find((t) => t.flowId === flowId && t.outcome === 'pass');
  const seconds = passedEarlier
    ? Math.max(0, Math.round((Date.parse(latest.run.ranAt) - Date.parse(earlier!.run.ranAt)) / 1000))
    : undefined;
  return {
    ...(failed ? { step: { order: failed.order, of: steps.length, title: failed.title } } : {}),
    ...(documented ? { documented } : {}),
    ...(observed ? { observed } : {}),
    ...(seconds !== undefined ? { passedEarlierSeconds: seconds } : {}),
  };
}

/** A document of the head's tree, by its ref; null when the tree does not hold it. */
function treeDoc(treeDir: string, doc: string): DocTree | null {
  const file = path.join(treeDir, ...doc.split('/'));
  return fs.existsSync(file) ? parseDocTree(doc, fs.readFileSync(file, 'utf-8')) : null;
}

/** Where a developer finds some sentences of a document. */
const shownAt = (doc: string, sentences: readonly { startLine: number; text: string }[]): PullRequestDocSentence => ({
  path: parseContextDocRef(doc)?.docPath ?? doc,
  line: sentences[0]!.startLine,
  sentence: sentences.map((s) => s.text).join(' '),
});

/** The sentences a flow's milestone at `order` is read from, as the head's tree holds them. */
function milestoneSentence(treeDir: string, flow: GuardFlow | undefined, order: number): PullRequestDocSentence | null {
  const milestone = flow?.milestones.find((m) => m.order === order);
  if (!milestone) return null;
  const tree = treeDoc(treeDir, milestone.doc);
  const byKey = tree ? sentencesByKey(tree) : new Map<string, DocTree['sentences'][number]>();
  const found = milestone.sentences.flatMap((key) => byKey.get(key) ?? []);
  if (found.length === 0) return { path: parseContextDocRef(milestone.doc)?.docPath ?? milestone.doc, line: null, sentence: milestone.claimTitle };
  return shownAt(milestone.doc, found);
}

/**
 * A rewritten test's renames, each name once, placed at the sentence that says
 * the documented name: one of the sentences of the step it was met in first,
 * then any sentence of the flow's documents. A name no sentence says has no place.
 */
function renames(
  treeDir: string,
  flow: GuardFlow | undefined,
  drifts: readonly FlowTestCopyDrift[],
): NonNullable<PullRequestCheckReport['run']>['rewritten'][number]['copyDrift'] {
  const seen = new Set<string>();
  return drifts.flatMap((drift) => {
    const name = `${drift.documented}\u0000${drift.observed}`;
    if (seen.has(name)) return [];
    seen.add(name);
    return [{ documented: drift.documented, observed: drift.observed, at: sentenceSaying(treeDir, flow, drift.step, drift.documented) }];
  });
}

function sentenceSaying(treeDir: string, flow: GuardFlow | undefined, step: number, words: string): PullRequestDocSentence | null {
  if (!flow) return null;
  const says = (s: { text: string }): boolean => s.text.includes(words);
  const milestone = flow.milestones.find((m) => m.order === step);
  if (milestone) {
    const tree = treeDoc(treeDir, milestone.doc);
    const byKey = tree ? sentencesByKey(tree) : new Map<string, DocTree['sentences'][number]>();
    const own = milestone.sentences.flatMap((key) => byKey.get(key) ?? []).find(says);
    if (own) return shownAt(milestone.doc, [own]);
  }
  for (const doc of new Set([...(milestone ? [milestone.doc] : []), ...flow.milestones.map((m) => m.doc)])) {
    const found = treeDoc(treeDir, doc)?.sentences.find(says);
    if (found) return shownAt(doc, [found]);
  }
  return null;
}

/** What a failed assertion says it expected and received, else the error's first line. */
function assertionOf(error: string | undefined): string | undefined {
  const lines = (error ?? '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const said = lines.filter((line) => /^(Expected|Received)\b/.test(line)).slice(0, 2);
  return (said.length > 0 ? said.join(' · ') : lines[0])?.slice(0, 300);
}
