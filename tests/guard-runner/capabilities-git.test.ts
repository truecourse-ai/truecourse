import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardGit } from '@truecourse/shared'
import { createSandbox, materializeGit, CapabilityError } from '@truecourse/guard-runner'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** Seed files, then materialize a git declaration in a fresh sandbox; return cwd. */
function materialize(git: GuardGit, files: Record<string, string>): string {
  const sb = createSandbox({ setupFiles: files })
  cleanups.push(sb.cleanup)
  materializeGit(git, { cwd: sb.cwd, env: sb.env })
  return sb.cwd
}

/** Read-only git query in the materialized repo. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trimEnd()
}

const FILES = { 'README.md': '# readme\n', 'CHANGELOG.md': 'changes\n', 'draft.txt': 'wip\n' }

describe('git capability — materialization', () => {
  it('initializes a repo on an empty block (`git: {}`), default branch main', () => {
    const cwd = materialize({}, FILES)
    expect(fs.existsSync(path.join(cwd, '.git'))).toBe(true)
    expect(git(cwd, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    // No commits, nothing staged (files exist but were never added).
    expect(git(cwd, ['status', '--porcelain'])).toContain('?? README.md')
  })

  it('honors a custom branch name', () => {
    const cwd = materialize({ branch: 'develop' }, FILES)
    expect(git(cwd, ['symbolic-ref', '--short', 'HEAD'])).toBe('develop')
  })

  it('builds the declared commit history with pinned identity + messages', () => {
    const cwd = materialize(
      { commits: [{ files: ['README.md'], message: 'add readme' }, { files: ['CHANGELOG.md'], message: 'add changelog' }] },
      { 'README.md': '# readme\n', 'CHANGELOG.md': 'changes\n' },
    )
    expect(git(cwd, ['log', '--format=%s'])).toBe('add changelog\nadd readme')
    expect(git(cwd, ['log', '--format=%an <%ae>', '-1'])).toBe('TrueCourse Guard <guard@truecourse.dev>')
    expect(git(cwd, ['log', '--format=%cn <%ce>', '-1'])).toBe('TrueCourse Guard <guard@truecourse.dev>')
    // Committer date pinned to the epoch (+0000).
    expect(git(cwd, ['log', '--format=%cd', '--date=iso', '-1'])).toBe('2000-01-01 00:00:00 +0000')
    // Committed files are clean; nothing dangling in the index.
    expect(git(cwd, ['status', '--porcelain'])).toBe('')
  })

  it('applies staged-but-uncommitted files after the commits', () => {
    const cwd = materialize(
      { commits: [{ files: ['README.md'] }], staged: ['draft.txt'] },
      { 'README.md': '# readme\n', 'draft.txt': 'wip\n' },
    )
    // draft.txt is staged (index add) but not committed.
    expect(git(cwd, ['status', '--porcelain'])).toBe('A  draft.txt')
    expect(git(cwd, ['diff', '--cached', '--name-only'])).toBe('draft.txt')
  })

  it('is byte-reproducible — identical declarations yield identical commit hashes', () => {
    const decl: GuardGit = {
      commits: [{ files: ['README.md'], message: 'add readme' }, { files: ['CHANGELOG.md'], message: 'add changelog' }],
      staged: ['draft.txt'],
    }
    const a = materialize(decl, FILES)
    const b = materialize(decl, FILES)
    expect(git(a, ['rev-list', '--all'])).toBe(git(b, ['rev-list', '--all']))
    expect(git(a, ['rev-parse', 'HEAD'])).toBe(git(b, ['rev-parse', 'HEAD']))
    expect(git(a, ['status', '--porcelain'])).toBe(git(b, ['status', '--porcelain']))
  })

  it('errors (naming the capability) when a declared commit file is not present', () => {
    expect(() => materialize({ commits: [{ files: ['missing.txt'] }] }, FILES)).toThrow(CapabilityError)
    try {
      materialize({ commits: [{ files: ['missing.txt'] }] }, FILES)
    } catch (e) {
      expect((e as CapabilityError).capability).toBe('git')
      expect((e as Error).message).toContain('setup.git')
      expect((e as Error).message).toContain('missing.txt')
    }
  })

  it('surfaces a failing git command as a capability error', () => {
    // A second commit staging the same unchanged file has nothing to commit —
    // `git commit` exits non-zero, which the provider turns into a CapabilityError.
    expect(() =>
      materialize({ commits: [{ files: ['README.md'] }, { files: ['README.md'] }] }, FILES),
    ).toThrow(/setup\.git: git commit/)
  })
})
