/**
 * Installation-scoped GitHub REST client + the few helpers Phase 2 needs:
 * list a PR's changed files, find/create/update our scan comment, and read a
 * PR's head ref.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { GithubAppConfig } from './config.js';

export type OctokitClient = Octokit;

export interface RepoCoords {
  owner: string;
  repo: string;
}

export function splitRepo(fullName: string): RepoCoords {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
}

export function installationOctokit(
  cfg: GithubAppConfig,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      installationId,
    },
  });
}

/** All changed file paths in a PR (added/modified/removed), paginated. */
export async function listPrFiles(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
): Promise<string[]> {
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map((f) => f.filename);
}

/**
 * Raw text of a repo file at `ref` (default branch when omitted), or null when
 * it's missing / unreadable. Used to read `.truecourse/config.json` before any
 * clone; the caller degrades a null to "no config".
 */
export async function getFileContent(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  filePath: string,
  ref?: string,
): Promise<string | null> {
  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ...(ref ? { ref } : {}),
      // `format: 'raw'` returns the file body directly as text.
      mediaType: { format: 'raw' },
    });
    return typeof res.data === 'string' ? res.data : null;
  } catch {
    return null;
  }
}

/** Our bot-authored comment carrying `marker` on the PR, or null. */
export async function findComment(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
  marker: string,
): Promise<{ id: number; body: string } | null> {
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  // Require a Bot author so a user can't hijack the slot by pasting our marker.
  const found = comments.find(
    (c) => c.user?.type === 'Bot' && (c.body ?? '').includes(marker),
  );
  return found ? { id: found.id, body: found.body ?? '' } : null;
}

/** The actor's permission on the repo: 'admin' | 'write' | 'read' | 'none'. */
export async function getActorPermission(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  username: string,
): Promise<string> {
  try {
    const res = await octokit.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    return res.data.permission;
  } catch {
    return 'none';
  }
}

export async function createComment(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
  body: string,
): Promise<number> {
  const res = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return res.data.id;
}

export async function updateComment(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  commentId: number,
  body: string,
): Promise<void> {
  await octokit.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}

/**
 * Open an in-progress Check run for a head sha so the PR shows "running" while the
 * gate works; returns its id to complete later with {@link postCheck}. Best-effort:
 * a failure just means no live "running" pill (the completed Check is still posted).
 */
export async function startCheck(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  name: string,
  headSha: string,
): Promise<number | null> {
  try {
    const { data } = await octokit.checks.create({
      owner,
      repo,
      name,
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    });
    return data.id;
  } catch {
    return null;
  }
}

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'action_required'
  | 'timed_out';

/** One inline annotation on a completed Check. GitHub caps them at 50 per request. */
export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title?: string;
  message: string;
}

/**
 * Post a Check run's result (the conclusion is authoritative). When `checkRunId` is
 * given, UPDATES that in-progress run (from {@link startCheck}) to completed instead
 * of creating a fresh one — so a single Check transitions running → done.
 */
export async function postCheck(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  name: string,
  headSha: string,
  conclusion: CheckConclusion,
  output: { title: string; summary: string; annotations?: CheckAnnotation[] },
  checkRunId?: number | null,
): Promise<void> {
  if (checkRunId != null) {
    await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output,
    });
    return;
  }
  await octokit.checks.create({
    owner,
    repo,
    name,
    head_sha: headSha,
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    output,
  });
}

/** Existing review comments on a PR (for dedup): path + line + author type. */
export async function listReviewComments(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
): Promise<{ path: string; line: number | null; userType: string | undefined }[]> {
  const comments = await octokit.paginate(octokit.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return comments.map((c) => ({
    path: c.path,
    line: c.line ?? null,
    userType: c.user?.type,
  }));
}

/** Post an inline review comment on a head-side line (throws if not in the diff). */
export async function createReviewComment(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
  params: { commitId: string; path: string; line: number; body: string },
): Promise<void> {
  await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: params.commitId,
    path: params.path,
    line: params.line,
    side: 'RIGHT',
    body: params.body,
  });
}

/** Open PRs targeting this repo, with the fields the gate needs to re-verify. */
export async function listOpenPrs(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
): Promise<
  Array<{
    number: number;
    headSha: string;
    headRef: string;
    /** Head repo full name; null/differs from base on a fork PR. */
    headRepoFullName: string | null;
    headRepoIsFork: boolean;
    baseSha: string;
    baseRef: string;
  }>
> {
  const prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  return prs.map((p) => ({
    number: p.number,
    headSha: p.head.sha,
    headRef: p.head.ref,
    headRepoFullName: p.head.repo?.full_name ?? null,
    headRepoIsFork: p.head.repo?.fork ?? false,
    baseSha: p.base.sha,
    baseRef: p.base.ref,
  }));
}

/**
 * Pull requests associated with a commit (GitHub's "list pull requests
 * associated with a commit"), reduced to what identifies a merged PR: its number,
 * whether it merged, the merge commit it produced, and its head sha. Used on a
 * default-branch push to map the merge/squash commit back to the PR it landed.
 */
export async function listPrsForCommit(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  commitSha: string,
): Promise<
  Array<{ number: number; merged: boolean; mergeCommitSha: string | null; headSha: string }>
> {
  const prs = await octokit.paginate(
    octokit.repos.listPullRequestsAssociatedWithCommit,
    { owner, repo, commit_sha: commitSha, per_page: 100 },
  );
  return prs.map((p) => ({
    number: p.number,
    merged: p.merged_at != null,
    mergeCommitSha: p.merge_commit_sha ?? null,
    headSha: p.head.sha,
  }));
}

export async function getPullRequest(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
): Promise<{
  headRef: string;
  headSha: string;
  /** Head repo full name; differs from the base on a fork PR. */
  headRepoFullName: string | null;
  baseRef: string;
  baseSha: string;
}> {
  const res = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return {
    headRef: res.data.head.ref,
    headSha: res.data.head.sha,
    headRepoFullName: res.data.head.repo?.full_name ?? null,
    baseRef: res.data.base?.ref ?? '',
    baseSha: res.data.base?.sha ?? '',
  };
}
