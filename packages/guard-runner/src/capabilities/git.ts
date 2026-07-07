/**
 * The `git` setup capability — materialize a declared git repo in the sandbox
 * cwd. Runs after `setup.files` seeding: `git init` (pinned branch), then each
 * declared commit (stage its files, commit), then the staged-but-uncommitted set.
 *
 * Determinism: author/committer identity and both dates are pinned to fixed
 * constants, the epoch date forces `+0000`, HOME is already sandboxed (no user
 * gitconfig), system config is disabled, and hooks/signing are skipped. The same
 * declaration therefore produces identical `git status --porcelain` AND identical
 * commit hashes on every materialization.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardGit } from '@truecourse/shared'
import { CapabilityError, type CapabilityContext } from './index.js'

/** Fixed commit identity — pinned so commit hashes are reproducible. */
const GIT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'TrueCourse Guard',
  GIT_AUTHOR_EMAIL: 'guard@truecourse.dev',
  GIT_COMMITTER_NAME: 'TrueCourse Guard',
  GIT_COMMITTER_EMAIL: 'guard@truecourse.dev',
}
/** Fixed commit clock; `Z` forces a `+0000` offset regardless of the host TZ. */
const GIT_EPOCH = '2000-01-01T00:00:00Z'
const DEFAULT_BRANCH = 'main'
const DEFAULT_MESSAGE = 'guard commit'

export function materializeGit(declaration: GuardGit, ctx: CapabilityContext): void {
  const branch = declaration.branch ?? DEFAULT_BRANCH
  // Base the git child env on the sandbox's allowlisted env (PATH, sandboxed
  // HOME), then pin identity/clock and disable system config so nothing on the
  // host machine can perturb the result.
  const gitEnv: NodeJS.ProcessEnv = {
    ...ctx.env,
    ...GIT_IDENTITY,
    GIT_AUTHOR_DATE: GIT_EPOCH,
    GIT_COMMITTER_DATE: GIT_EPOCH,
    GIT_CONFIG_NOSYSTEM: '1',
  }

  runGit(['init', '-q', '-b', branch], ctx, gitEnv)

  for (const commit of declaration.commits ?? []) {
    requireFiles(commit.files, ctx)
    runGit(['add', '--', ...commit.files], ctx, gitEnv)
    // --no-verify skips hooks; --no-gpg-sign defeats any commit.gpgsign default.
    runGit(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', commit.message ?? DEFAULT_MESSAGE], ctx, gitEnv)
  }

  if (declaration.staged && declaration.staged.length > 0) {
    requireFiles(declaration.staged, ctx)
    runGit(['add', '--', ...declaration.staged], ctx, gitEnv)
  }
}

/** Every declared path must already exist in the sandbox and stay inside it. */
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
