/**
 * The `git` setup capability — materialize a declared git repo in the sandbox
 * cwd (or in the declared `root` beneath it, when the flow needs siblings of the
 * checkout). Runs after `setup.files` seeding: `git init` (pinned branch), then
 * each declared commit (stage its files, commit), then the staged-but-uncommitted
 * set.
 *
 * Determinism: author/committer identity and both dates are pinned — to the
 * scenario's declared `identity` when it states one, else to fixed constants,
 * never to the developer's — the epoch date forces `+0000`, HOME is already
 * sandboxed, global AND system config are switched off, and hooks/signing are
 * skipped. The same declaration therefore produces identical
 * `git status --porcelain` AND identical commit hashes on every materialization.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardGit } from '@truecourse/shared'
import { CapabilityError, type CapabilityContext } from './index.js'

/** Fixed commit identity — the default when a scenario declares none. */
export const GIT_DEFAULT_IDENTITY = { name: 'TrueCourse Guard', email: 'guard@truecourse.dev' }

/** Fixed commit clock; `Z` forces a `+0000` offset regardless of the host TZ. */
const GIT_EPOCH = '2000-01-01T00:00:00Z'
const DEFAULT_BRANCH = 'main'
const DEFAULT_MESSAGE = 'guard commit'

/**
 * The env EVERY git invocation guard makes runs under — the setup capability's and
 * a scenario's own `git` steps alike, so the two can never disagree about whose
 * identity a sandbox commit carries.
 *
 * `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_NOSYSTEM` hide the developer's `~/.gitconfig`
 * and `/etc/gitconfig` outright: HOME is already sandboxed, but git also honours
 * `XDG_CONFIG_HOME` and an absolute system path, and a host setting like
 * `commit.gpgsign` or a hooks path would otherwise decide a sandbox outcome.
 */
export function gitChildEnv(
  base: NodeJS.ProcessEnv,
  identity: { name: string; email: string } = GIT_DEFAULT_IDENTITY,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
    GIT_AUTHOR_DATE: GIT_EPOCH,
    GIT_COMMITTER_DATE: GIT_EPOCH,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

export function materializeGit(declaration: GuardGit, ctx: CapabilityContext): void {
  const branch = declaration.branch ?? DEFAULT_BRANCH
  const gitEnv = gitChildEnv(ctx.env, declaration.identity)
  // The repo root: the sandbox cwd, or the declared subdirectory (created if the
  // seeds did not). Everything below is relative to it, as it is in a real repo.
  const root = path.resolve(ctx.cwd, declaration.root ?? '.')
  if (root !== ctx.cwd && !root.startsWith(ctx.cwd + path.sep)) {
    throw new CapabilityError('git', `root escapes the sandbox: ${declaration.root}`)
  }
  fs.mkdirSync(root, { recursive: true })
  const repo: CapabilityContext = { ...ctx, cwd: root }

  runGit(['init', '-q', '-b', branch], repo, gitEnv)

  for (const commit of declaration.commits ?? []) {
    requireFiles(commit.files, repo)
    runGit(['add', '--', ...commit.files], repo, gitEnv)
    // --no-verify skips hooks; --no-gpg-sign defeats any commit.gpgsign default.
    runGit(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', commit.message ?? DEFAULT_MESSAGE], repo, gitEnv)
  }

  if (declaration.staged && declaration.staged.length > 0) {
    requireFiles(declaration.staged, repo)
    runGit(['add', '--', ...declaration.staged], repo, gitEnv)
  }
}

/** Every declared path must already exist in the repo root and stay inside it. */
function requireFiles(files: readonly string[], ctx: CapabilityContext): void {
  for (const rel of files) {
    const target = path.resolve(ctx.cwd, rel)
    if (target !== ctx.cwd && !target.startsWith(ctx.cwd + path.sep)) {
      throw new CapabilityError('git', `path escapes the sandbox: ${rel}`)
    }
    if (!fs.existsSync(target)) {
      throw new CapabilityError(
        'git',
        `declared file does not exist in the sandbox: ${rel} (seed it via setup.files or an earlier commit)`,
      )
    }
  }
}

/** Run one git command in the sandbox; a spawn failure or non-zero exit throws. */
function runGit(args: string[], ctx: CapabilityContext, env: NodeJS.ProcessEnv): void {
  const res = spawnSync('git', args, { cwd: ctx.cwd, env, encoding: 'utf-8' })
  if (res.error) {
    const enoent = (res.error as NodeJS.ErrnoException).code === 'ENOENT'
    throw new CapabilityError(
      'git',
      enoent ? 'git binary not found on PATH' : `git ${args[0]} failed to spawn: ${res.error.message}`,
    )
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim()
    throw new CapabilityError('git', `git ${args.join(' ')} failed (exit ${res.status})${detail ? `: ${detail}` : ''}`)
  }
}
