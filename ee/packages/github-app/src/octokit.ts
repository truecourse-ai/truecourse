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

/** Post a completed Check run for a head sha (the conclusion is authoritative). */
export async function postCheck(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  name: string,
  headSha: string,
  conclusion: 'success' | 'failure' | 'neutral',
  output: { title: string; summary: string },
): Promise<void> {
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

export async function getPullRequest(
  octokit: Octokit,
  { owner, repo }: RepoCoords,
  prNumber: number,
): Promise<{
  headRef: string;
  headSha: string;
  /** Head repo full name; differs from the base on a fork PR. */
  headRepoFullName: string | null;
}> {
  const res = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return {
    headRef: res.data.head.ref,
    headSha: res.data.head.sha,
    headRepoFullName: res.data.head.repo?.full_name ?? null,
  };
}
