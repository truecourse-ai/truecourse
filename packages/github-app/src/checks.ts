/**
 * The Checks API, in one place: the one check run TrueCourse posts per pull
 * request check — created `queued` when the check is enqueued, moved to
 * `in_progress` as the job works and `completed` when it settles — and the
 * summary and annotations it carries. Nothing else calls `checks.*`.
 *
 * The summary is the check's report as markdown, counts first; annotations
 * mark the conflicts the pull request created on the changed documents' own
 * lines, fifty per request as the API takes them. Nothing is posted as a
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

/** The one-line title each reason wears on the check. */
const CHECK_TITLE_OF_REASON: Record<PullRequestCheckReason, string> = {
  clean: 'No new failures, no conflicts created',
  'new-failures': 'New failures',
  conflict: 'Conflicts with the documentation',
  'build-failed': 'The pull request does not build',
  'no-base': 'Not checked: no base to compare against',
  draft: 'Checked when ready for review',
  superseded: 'Superseded by a newer commit',
  cancelled: 'Cancelled',
  credits: 'Paused: the workspace is out of credits',
  error: 'The check could not run',
};

/**
 * The check's output for a settled report: the four parts in order, counts
 * first, capped at what GitHub accepts (cut back to the counts and the link
 * when the whole would not fit), and one annotation per created conflict
 * that names a changed document's line.
 */
export function renderCheckOutput(
  reason: PullRequestCheckReason,
  report: PullRequestCheckReport | null,
  detailsUrl: string | null,
): CheckOutput {
  const title = CHECK_TITLE_OF_REASON[reason];
  if (!report) return { title, summary: settledWithoutReport(reason, detailsUrl) };
  const counts = countsLine(report);
  const full = [counts, ...sections(report), link(detailsUrl)].filter(Boolean).join('\n\n');
  const summary = full.length <= SUMMARY_LIMIT ? full : [counts, link(detailsUrl)].filter(Boolean).join('\n\n');
  const annotations: CheckAnnotation[] = report.conflictsCreated.flatMap((c) =>
    c.path !== null && c.line !== null
      ? [{ path: c.path, startLine: c.line, message: `Conflicts with ${c.docs[1]}: ${c.note}` }]
      : [],
  );
  return { title, summary, ...(annotations.length > 0 ? { annotations } : {}) };
}

function settledWithoutReport(reason: PullRequestCheckReason, detailsUrl: string | null): string {
  const lines: Record<PullRequestCheckReason, string> = {
    clean: 'Nothing to report.',
    'new-failures': 'See the details.',
    conflict: 'See the details.',
    'build-failed': 'Setup or the run could not bring the pull request up. See the details.',
    'no-base': 'The commit this pull request branched from has no stored state to compare against. Rebase onto a newer default-branch commit to be checked.',
    draft: 'Drafts are not checked. Mark the pull request ready for review and it will be.',
    superseded: 'A newer commit was pushed; that one is checked instead.',
    cancelled: 'The check was stopped before it settled.',
    credits: 'The check carries on as soon as the workspace can spend again.',
    error: 'Something on our side stopped the check; it was not the pull request.',
  };
  return [lines[reason], link(detailsUrl)].filter(Boolean).join('\n\n');
}

function countsLine(report: PullRequestCheckReport): string {
  const parts = [
    `${report.conflictsCreated.length} conflict${report.conflictsCreated.length === 1 ? '' : 's'} created`,
    `${report.sectionsMoved.length} section${report.sectionsMoved.length === 1 ? '' : 's'} moved`,
    `${report.repositoriesAffected.length} other repositor${report.repositoriesAffected.length === 1 ? 'y' : 'ies'} affected`,
  ];
  if (report.run) {
    const c = report.run.counts;
    parts.push(
      `${c.newFailures} new failure${c.newFailures === 1 ? '' : 's'}`,
      `${c.preExisting} pre-existing`,
      `${c.fixed} fixed`,
    );
  } else {
    parts.push(`code not run (${report.codeHalf.replace(/-/g, ' ')})`);
  }
  return `**${parts.join(' · ')}**`;
}

function sections(report: PullRequestCheckReport): string[] {
  const out: string[] = [];
  if (report.conflictsCreated.length > 0) {
    out.push(
      `## Conflicts created\n\n${report.conflictsCreated
        .map((c) => `- ${c.docs[0]} · ${c.sections[0].join(', ') || 'lead'} vs ${c.docs[1]} · ${c.sections[1].join(', ') || 'lead'}: ${c.note}`)
        .join('\n')}`,
    );
  }
  if (report.sectionsMoved.length > 0) {
    out.push(
      `## Sections moved\n\n${report.sectionsMoved
        .map((s) => `- ${s.doc} · ${s.anchor}${s.flows.length > 0 ? ` (${s.flows.map((f) => f.title).join(', ')})` : ''}`)
        .join('\n')}`,
    );
  }
  if (report.repositoriesAffected.length > 0) {
    out.push(`## Repositories affected\n\n${report.repositoriesAffected.map((r) => `- ${r.repoFullName}`).join('\n')}`);
  }
  if (report.run) {
    const lines: string[] = [];
    const list = (heading: string, flows: readonly { title: string }[]): void => {
      if (flows.length > 0) lines.push(`### ${heading}\n\n${flows.map((f) => `- ${f.title}`).join('\n')}`);
    };
    list('New failures', report.run.newFailures.map((f) => ({ title: f.label ? `${f.title} (${f.label})` : f.title })));
    list('Pre-existing failures', report.run.preExisting);
    list('Fixed', report.run.fixed);
    list('Could not run at the head', report.run.newlyBlocked.map((f) => ({ title: `${f.title}: ${f.why}` })));
    out.push(`## The run\n\n${lines.length > 0 ? lines.join('\n\n') : 'Every flow held.'}`);
  }
  return out;
}

const link = (detailsUrl: string | null): string => (detailsUrl ? `[The full report](${detailsUrl})` : '');
