/**
 * Fix 1 (PR 1): on EVERY expect-mismatch, runScenario attaches the failing step's
 * RAW program output (head-truncated to 1200 chars per stream) to the returned
 * `failure` — the un-normalized child stdout/stderr, so the birth-retry/finding
 * sees the usage error the program actually printed. Empty streams are omitted.
 * Infra failures (spawn/timeout) keep their old shape (no capture ⇒ no excerpts).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { runScenario, resolveEntry, type RunScenarioContext } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeSpecDoc, scenario, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  writeSpecDoc(r)
  repos.push(r)
  return r
}

function ctxFor(r: string, overrides: Partial<RunScenarioContext> = {}): RunScenarioContext {
  return {
    repoRoot: r,
    runId: 'test-run',
    resolvedEntry: resolveEntry(r, ['node', FIXTURE_BIN]),
    stepTimeoutMs: 10_000,
    capturePassEvidence: false,
    ...overrides,
  }
}

describe('runScenario — failure output excerpts', () => {
  it('attaches raw stderr on an exit mismatch and omits the empty stdout stream', async () => {
    const r = repo()
    // `boom` → exit 7, stderr "fatal: intentional failure", stdout empty.
    const res = await runScenario(
      scenario({ id: 'boom', steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.actual).toContain('exit 7')
    expect(res.failure!.stderr).toContain('fatal: intentional failure')
    // stdout was empty → omitted entirely, no empty-string noise.
    expect(res.failure!.stdout).toBeUndefined()
  })

  it('attaches raw stdout on a stdout-matcher mismatch and omits empty stderr', async () => {
    const r = repo()
    // `--version` → stdout "2.4.1\n", stderr empty; expect a value it never prints.
    const res = await runScenario(
      scenario({ id: 'ver', steps: [{ run: ['--version'], expect: { stdout: { equals: 'nope' } } }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.stdout).toContain('2.4.1')
    expect(res.failure!.stderr).toBeUndefined()
  })

  it('captures RAW output, not the normalized text used for matching', async () => {
    const r = repo()
    // `report` prints a version + timestamp; the `versions` normalizer rewrites
    // 2.4.1 → <VERSION> for the MATCH, but the excerpt must be the raw bytes.
    const res = await runScenario(
      scenario({
        id: 'report',
        normalize: ['versions', 'timestamps', 'durations', 'abs-paths'],
        steps: [{ run: ['report'], expect: { stdout: { equals: 'wrong' } } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.stdout).toContain('2.4.1')
    expect(res.failure!.stdout).not.toContain('<VERSION>')
  })

  it('attaches the raw stderr on a stderr-matcher mismatch', async () => {
    const r = repo()
    // `boom` exits 7 (matched) but its stderr does not contain the required text.
    const res = await runScenario(
      scenario({
        id: 'boomerr',
        steps: [{ run: ['boom'], expect: { exit: 7, stderr: { contains: 'never-printed' } } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.stderr).toContain('fatal: intentional failure')
  })

  it('attaches excerpts on a files-matcher mismatch', async () => {
    const r = repo()
    // `check` with a seeded config → stdout "ok: seeded", exit 0; the file assertion
    // (a path that never exists) is what fails.
    const res = await runScenario(
      scenario({
        id: 'check',
        setup: { files: { '.relkitrc.json': '{"name":"seeded","strict":false}' } },
        steps: [{ run: ['check'], expect: { exit: 0, files: { 'ghost.txt': { exists: true } } } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.actual).toContain('ghost.txt')
    expect(res.failure!.stdout).toContain('ok: seeded')
  })

  it('head-truncates each excerpt to 1200 chars', async () => {
    const r = repo()
    // `shout` echoes uppercased stdin; feed 2000 chars → 2000-char stdout.
    const res = await runScenario(
      scenario({
        id: 'big',
        steps: [{ run: ['shout'], stdin: 'a'.repeat(2000), expect: { exit: 1 } }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.stdout).toHaveLength(1200)
    expect(res.failure!.stdout).toBe('A'.repeat(1200))
  })

  it('does NOT attach excerpts on an infra failure (timeout — no capture mismatch)', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({ id: 'hang', steps: [{ run: ['hang'], expect: { exit: 0 } }] }),
      ctxFor(r, { stepTimeoutMs: 300 }),
    )
    expect(res.outcome).toBe('error')
    expect(res.failure!.actual).toContain('timed out')
    expect(res.failure!.stdout).toBeUndefined()
    expect(res.failure!.stderr).toBeUndefined()
  })
})
