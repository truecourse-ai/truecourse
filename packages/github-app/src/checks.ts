/**
 * The Checks API, in one place: the one check run TrueCourse posts per pull
 * request check — created `queued` when the check is enqueued, moved to
 * `in_progress` as the job works and `completed` when it settles — and the
 * summary and annotations it carries. Nothing else calls `checks.*`.
 *
 * The summary is the check's report as markdown, written for the developer
 * who opened the pull request: what happened, what to do, then the evidence;
 * annotations mark the conflicts the pull request created on the changed
 * documents' own lines, fifty per request as the API takes them. Nothing is posted as a
 * comment: the check is the whole conversation.
 */

import {
  CHECK_CONCLUSION_OF_REASON,
  type PullRequestCheckReason,
  type PullRequestCheckReport,
} from '@truecourse/shared';
import type { OctokitClient } from './octokit.js';
import { splitRepo } from './octokit.js';

/** What every check run is named on GitHub. */
export const CHECK_NAME = 'TrueCourse';

/** GitHub takes at most this many annotations per request. */
const ANNOTATIONS_PER_REQUEST = 50;

/** GitHub refuses a summary longer than this. */
const SUMMARY_LIMIT = 60_000;

export interface CheckAnnotation {
  path: string;
  startLine: number;
  message: string;
}

export interface CheckOutput {
  title: string;
  summary: string;
  annotations?: CheckAnnotation[];
}

export interface CheckCreateInput {
  headSha: string;
  /** Our check's id, so a re-run request names it back to us. */
  externalId: string;
}

/** Post the check as queued; answers GitHub's id for it. */
export async function createCheck(
  octokit: OctokitClient,
  repoFullName: string,
  input: CheckCreateInput,
): Promise<number> {
  const { data } = await octokit.checks.create({
    ...splitRepo(repoFullName),
    name: CHECK_NAME,
    head_sha: input.headSha,
    external_id: input.externalId,
    status: 'queued',
  });
  return data.id;
}

export interface CheckUpdateInput {
  status: 'in_progress' | 'completed';
  /** Required with `completed`. */
  reason?: PullRequestCheckReason;
  /** `conflict` concludes failure when the pull request created one; the caller says. */
  conclusion?: 'success' | 'failure' | 'neutral';
  detailsUrl?: string;
  output: CheckOutput;
}

/**
 * Move the check on. Annotations beyond the first fifty go in further
 * requests carrying the same output, which is how the API accumulates them.
 */
export async function updateCheck(
  octokit: OctokitClient,
  repoFullName: string,
  checkRunId: number,
  input: CheckUpdateInput,
): Promise<void> {
  const annotations = (input.output.annotations ?? []).map((a) => ({
    path: a.path,
    start_line: a.startLine,
    end_line: a.startLine,
    annotation_level: 'failure' as const,
    message: a.message,
  }));
  const pages = annotations.length === 0 ? [[]] : chunk(annotations, ANNOTATIONS_PER_REQUEST);
  for (const page of pages) {
    await octokit.checks.update({
      ...splitRepo(repoFullName),
      check_run_id: checkRunId,
      status: input.status,
      ...(input.status === 'completed'
        ? { conclusion: input.conclusion ?? CHECK_CONCLUSION_OF_REASON[input.reason ?? 'error'] }
        : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: {
        title: input.output.title,
        summary: input.output.summary,
        ...(page.length > 0 ? { annotations: page } : {}),
      },
    });
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/** What an open check says while the job it waits on is paused for credits. */
export const PAUSED_CHECK_OUTPUT: CheckOutput = {
  title: 'Paused: the workspace is out of credits',
  summary: 'The check carries on as soon as the workspace can spend again.',
};

type Report = PullRequestCheckReport;
type Run = NonNullable<Report['run']>;
type CreatedConflict = Report['conflictsCreated'][number];

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const short = (sha: string): string => `\`${sha.slice(0, 8)}\``;
const at = (path: string, line: number | null): string => `\`${line === null ? path : `${path}:${line}`}\``;
const quoted = (sentence: string): string => `"${sentence}"`;
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The one line a check wears: what happened, in the words of the developer who opened the pull request. */
function checkTitle(reason: PullRequestCheckReason, report: Report | null): string {
  switch (reason) {
    case 'new-failures': {
      const n = report?.run?.newFailures.length ?? 0;
      return `${n} documented ${plural(n, 'behavior', 'behaviors')} broke`;
    }
    case 'conflict': {
      const n = report?.conflictsCreated.length ?? 0;
      return n > 0
        ? `${n} document ${plural(n, 'conflict needs', 'conflicts need')} a decision`
        : 'Not tested: the documentation has unresolved conflicts';
    }
    case 'clean': {
      if (!report?.run) return 'Nothing to test: this repository reads no documents';
      const n = report.run.rewritten.length;
      return n > 0
        ? `All documented flows succeeded. ${n} ${plural(n, 'flow was', 'flows were')} rewritten`
        : 'All documented flows succeeded';
    }
    case 'build-failed':
      return "The project doesn't build at this commit";
    case 'error':
      return report?.build ? "The project doesn't build at this commit" : "TrueCourse couldn't finish this check";
    case 'no-base':
      return 'Not checked: rebase onto a newer commit';
    case 'draft':
      return 'Not checked: draft pull request';
    case 'superseded':
      return 'Replaced by the check of a newer commit';
    case 'cancelled':
      return 'The check was stopped before it finished';
  }
}

/**
 * The check's output for a settled report, written for the developer who
 * opened the pull request: a title that says what happened, then what to do,
 * then the evidence, every document named by its path and line. Capped at what
 * GitHub accepts (cut back to the opening and the link when the whole would not
 * fit), with one annotation per created conflict on the changed document's line.
 */
export function renderCheckOutput(
  reason: PullRequestCheckReason,
  report: Report | null,
  detailsUrl: string | null,
): CheckOutput {
  const title = checkTitle(reason, report);
  if (!report) return { title, summary: [WITHOUT_A_REPORT[reason], link('The full report', detailsUrl)].filter(Boolean).join('\n\n') };
  const [opening, ...rest] = body(reason, report, detailsUrl);
  const closing = closingLink(reason, report, detailsUrl);
  const full = [opening, ...rest, closing].filter(Boolean).join('\n\n');
  const summary = full.length <= SUMMARY_LIMIT ? full : [opening, closing].filter(Boolean).join('\n\n');
  const annotations: CheckAnnotation[] = report.conflictsCreated.flatMap((c) =>
    c.path !== null && c.line !== null ? [{ path: c.path, startLine: c.line, message: conflictAnnotation(c) }] : [],
  );
  return { title, summary, ...(annotations.length > 0 ? { annotations } : {}) };
}

/** What a check settled without a report says. */
const WITHOUT_A_REPORT: Record<PullRequestCheckReason, string> = {
  clean: 'Nothing in this PR breaks a behavior the documentation describes.',
  'new-failures': 'This PR breaks a behavior the documentation describes.',
  conflict: 'Tests did not run: the documents disagree.',
  'build-failed': 'The project could not be built or started at this commit, so no tests ran.',
  'no-base': 'This PR branched from a commit TrueCourse has not tested. Rebase onto a newer commit and the check will run.',
  draft: 'Mark the pull request ready for review to check it.',
  superseded: 'A newer commit was pushed; that one is checked instead.',
  cancelled: 'Nothing was decided about this commit.',
  error: 'Re-run the check from GitHub. If it fails again, see what stopped it.',
};

/** The opening paragraph, then each section that has something in it. */
function body(reason: PullRequestCheckReason, report: Report, detailsUrl: string | null): string[] {
  const run = report.run;
  const created = report.conflictsCreated;
  const conflicts = created.length > 0 ? [conflictList(created)] : [];
  const runSections = [...(run ? runDetails(run) : []), ...documentSections(report)];
  switch (reason) {
    case 'new-failures': {
      const n = run?.newFailures.length ?? 0;
      return [
        `This PR breaks ${plural(n, 'a behavior', 'behaviors')} the documentation describes. Fix the code, or update the document if the behavior changed on purpose.`,
        ...(run ? newFailures(run) : []),
        ...conflicts,
        ...runSections,
      ];
    }
    case 'conflict':
      if (created.length === 0) {
        return [
          `Tests are paused for this repository until its document conflicts are resolved ${link('in TrueCourse', detailsUrl) || 'in TrueCourse'}. Nothing in this PR caused them.`,
        ];
      }
      return [conflictOpening(created, detailsUrl), ...conflicts, ...documentSections(report)];
    case 'clean':
      if (!run) return ['This repository reads no documents, so there is nothing to test.', ...conflicts];
      return ['Nothing in this PR breaks a behavior the documentation describes.', ...conflicts, ...runSections];
    case 'build-failed':
    case 'error':
      if (report.build) return buildFailure(report);
      return reason === 'error'
        ? [`Re-run the check from GitHub. If it fails again, ${link('see what stopped it', detailsUrl) || 'see what stopped it'}.`]
        : ['The project could not be built or started at this commit, so no tests ran.'];
    case 'no-base':
      return [noBase(report.base)];
    default:
      return [WITHOUT_A_REPORT[reason]];
  }
}

/** The link the summary ends on, worded for what it opens; none where the opening already links. */
function closingLink(reason: PullRequestCheckReason, report: Report, detailsUrl: string | null): string {
  switch (reason) {
    case 'new-failures':
    case 'clean':
      return report.run ? link('Full run', detailsUrl) : '';
    case 'build-failed':
    case 'error':
      return report.build ? link('Full build log', detailsUrl) : reason === 'error' ? '' : link('See what failed', detailsUrl);
    case 'conflict':
    case 'no-base':
      return '';
    default:
      return link('The full report', detailsUrl);
  }
}

/** Each broken behavior: the documented sentence, what the product did, and where the test stopped. */
function newFailures(run: Run): string[] {
  const blocks = run.newFailures.map((f) => {
    const lines = [`### ${f.label ? `${f.title} (${f.label})` : f.title}`];
    if (f.documented) lines.push(`${at(f.documented.path, f.documented.line)} ${quoted(f.documented.sentence)}`);
    if (f.observed) lines.push(`**Observed:** ${f.observed}`);
    if (f.step) lines.push(`Failed at step ${f.step.order} of ${f.step.of}: *${f.step.title}*`);
    if (f.passedEarlierSeconds !== undefined) {
      lines.push(`⚠ This test passed on this same commit ${f.passedEarlierSeconds} ${plural(f.passedEarlierSeconds, 'second', 'seconds')} earlier. It may be flaky.`);
    }
    return lines.join('\n');
  });
  const held = run.counts.held;
  if (held > 0) blocks.push(`${held} other documented ${plural(held, 'flow still holds', 'flows still hold')}.`);
  return blocks;
}

/** The opening of a check the pull request's own document conflicts stopped. */
function conflictOpening(created: readonly CreatedConflict[], detailsUrl: string | null): string {
  const there = link('in TrueCourse', detailsUrl) || 'in TrueCourse';
  const lead = "Tests did not run: the documents disagree, and TrueCourse can't tell which one is right.";
  return created.every((c) => c.ruling !== null)
    ? `${lead} This PR made changes in the document you had already ruled on, so that ruling no longer applies to it. Confirm it again ${there}, or change one of the documents.`
    : `${lead} This PR adds a sentence another document contradicts. Decide which one is right ${there}, or change one of the documents.`;
}

/** The conflicts grouped by the sentence the pull request edited, each with what disagrees with it. */
function conflictList(created: readonly CreatedConflict[]): string {
  const groups = new Map<string, { anchor: CreatedConflict['sides'][number] | null; against: string[] }>();
  for (const c of created) {
    if (c.sides.length !== 2) {
      // A report stored before sides were recorded names the two documents only.
      const key = `docs:${c.docs.join(' vs ')}`;
      groups.set(key, { anchor: null, against: [...(groups.get(key)?.against ?? []), `- ${c.docs[0]} vs ${c.docs[1]}: ${c.note}`] });
      continue;
    }
    const anchor = c.sides.find((side) => side.edited) ?? c.sides[0]!;
    const other = c.sides.find((side) => side !== anchor) ?? c.sides[1]!;
    const ruled = c.ruling
      ? c.ruling.right
        ? ` On ${day(c.ruling.at)} you ruled ${at(c.ruling.right, null)} right.`
        : ` On ${day(c.ruling.at)} you dismissed it.`
      : '';
    const key = `${anchor.path}:${anchor.line}:${anchor.sentence}`;
    groups.set(key, { anchor, against: [...(groups.get(key)?.against ?? []), `- ${at(other.path, other.line)} ${quoted(other.sentence)}${ruled}`] });
  }
  return [...groups.values()]
    .map(({ anchor, against }) =>
      anchor
        ? `**${at(anchor.path, anchor.line)}**${anchor.edited ? ' (edited in this PR)' : ''}\n${quoted(anchor.sentence)}\n\ndisagrees with\n\n${against.join('\n')}`
        : against.join('\n'),
    )
    .join('\n\n');
}

function conflictAnnotation(c: CreatedConflict): string {
  const other = c.sides.find((side) => !side.edited);
  return other ? `Disagrees with ${other.path}${other.line === null ? '' : `:${other.line}`}: ${quoted(other.sentence)}` : `Conflicts with ${c.docs[1]}: ${c.note}`;
}

/** Everything else the run found, each section only when it has something in it. */
function runDetails(run: Run): string[] {
  const out: string[] = [];
  const list = (heading: string, items: readonly string[], lead?: string): void => {
    if (items.length > 0) out.push([`### ${heading}`, ...(lead ? [lead] : []), items.join('\n')].join('\n'));
  };
  if (run.rewritten.length > 0) out.push(rewritten(run.rewritten));
  list('Now passing', run.fixed.map((f) => `- ${f.title}`));
  list('Newly covered', run.newlyCovered.map((f) => `- **${f.title}**: had no passing test before; passes now.`));
  list("Couldn't be tested on this PR", run.newlyBlocked.map((f) => `- **${f.title}**: ${f.why}`));
  list('Already failing on the default branch', run.preExisting.map((f) => `- ${f.title}`), 'Not affected by this PR.');
  return out;
}

/** The documents the pull request changed under tested flows, and the other repositories that read them. */
function documentSections(report: Report): string[] {
  const out: string[] = [];
  if (report.docsMoved.length > 0) {
    out.push(
      `### Documents this PR changed under tested flows\n${report.docsMoved
        .map((d) => `- ${at(d.doc, null)}${d.flows.length > 0 ? `: ${d.flows.map((f) => f.title).join(', ')}` : ''}`)
        .join('\n')}`,
    );
  }
  if (report.repositoriesAffected.length > 0) {
    out.push(`### Other repositories that read these documents\n${report.repositoriesAffected.map((r) => `- ${r.repoFullName}`).join('\n')}`);
  }
  return out;
}

/** The flows whose test the pull request rewrote to keep passing, and the renames behind them. */
function rewritten(flows: Run['rewritten']): string {
  const said = (drift: Run['rewritten'][number]['copyDrift'][number]): string =>
    `the product says ${quoted(drift.observed)} where the docs say ${quoted(drift.documented)}${drift.at ? ` (${at(drift.at.path, drift.at.line)})` : ''}`;
  let previous = '';
  const items = flows.map((f) => {
    if (f.copyDrift.length === 0) return `- **${f.title}**: its test was rewritten.`;
    const renames = f.copyDrift.map((d) => `${d.documented}\u0000${d.observed}`).join('\u0001');
    const same = renames === previous;
    previous = renames;
    return `- **${f.title}**: ${same ? 'same rename.' : `${f.copyDrift.map(said).join('; ')}.`}`;
  });
  return [
    `### Rewritten flows (${flows.length})`,
    'A test changed so that it passes can hide a regression; these are worth a look.',
    items.join('\n'),
  ].join('\n');
}

/** Why no tests ran: the build failed, quoting the end of what it printed. */
function buildFailure(report: Report): string[] {
  const build = report.build!;
  const base = report.base.commit ? ` The same build script worked on the default branch (${short(report.base.commit)}).` : '';
  return [
    `The build failed ${build.failures} ${plural(build.failures, 'time', 'times')}, so no tests ran.${base}`,
    ['```', build.output.trim(), '```'].join('\n'),
  ];
}

/** Why a pull request was not checked for want of a base, and where to rebase so it can be. */
function noBase(base: Report['base']): string {
  const from = base.mergeBase ? ` from ${short(base.mergeBase)}` : '';
  const onto = base.nearestWithBase ? `onto ${short(base.nearestWithBase)} or a newer commit` : 'onto a newer commit of the default branch';
  return `This PR branched${from}, which TrueCourse has not tested. Rebase ${onto} and the check will run.`;
}

const link = (label: string, detailsUrl: string | null): string => (detailsUrl ? `[${label}](${detailsUrl})` : '');
