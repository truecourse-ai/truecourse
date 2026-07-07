import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  runGuard,
  defaultRunConcurrency,
  guardLatestPath,
  guardRunPath,
  guardRunsDir,
  guardHistoryPath,
  evidenceRunDir,
  readGuardHistory,
} from '@truecourse/guard-runner'
import { GuardLatestSchema } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const bindsFor = specBinds

describe('runGuard — end to end', () => {
  it('runs scenarios and writes a schema-valid LATEST.json', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/version.yaml',
      scenario({
        id: 'ver',
        binds: bindsFor('cli/version'),
        steps: [{ run: ['--version'], expect: { exit: 0, stdout: { matches: '^\\d+\\.\\d+\\.\\d+' } } }],
      }),
    )
    writeScenario(
      r,
      'cli/who.yaml',
      scenario({ id: 'who', binds: bindsFor('cli/whoami'), steps: [{ run: ['whoami'], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'cli/boom.yaml',
      scenario({ id: 'boom.fail', binds: bindsFor('cli/boom'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return

    // LATEST is both returned and persisted, and validates against the shared Zod.
    expect(() => GuardLatestSchema.parse(res.latest)).not.toThrow()
    const onDisk = JSON.parse(fs.readFileSync(guardLatestPath(r), 'utf-8'))
    expect(() => GuardLatestSchema.parse(onDisk)).not.toThrow()
    expect(res.latestPath).toBe(guardLatestPath(r))

    expect(res.latest.summary).toMatchObject({ total: 3, pass: 2, fail: 1, error: 0 })
    expect(res.latest.run.scenarioFormat).toBe(1)
    expect(res.latest.run.recipeFingerprint).toMatch(/^sha256:/)

    const boom = res.latest.scenarios.find((s) => s.id === 'boom.fail')!
    expect(boom.outcome).toBe('fail')
    expect(boom.failure).toMatchObject({ step: 1 })
    expect(boom.failure!.expected).toContain('exit 0')
    expect(boom.failure!.actual).toContain('exit 7')
    expect(boom.evidencePath).toBeTruthy()

    // Passing scenarios carry no failure and no evidence pointer.
    const ver = res.latest.scenarios.find((s) => s.id === 'ver')!
    expect(ver.outcome).toBe('pass')
    expect(ver.failure).toBeUndefined()
    expect(ver.evidencePath).toBeUndefined()
  })

  it('writes an evidence transcript (with the expectation diff) only for failures', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'p.yaml', scenario({ id: 'pass1', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    writeScenario(r, 'f.yaml', scenario({ id: 'fail1', steps: [{ run: ['boom'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return

    const evDir = evidenceRunDir(r, res.latest.run.runId)
    expect(fs.readdirSync(evDir).sort()).toEqual(['fail1']) // no dir for the pass

    const diff = fs.readFileSync(path.join(evDir, 'fail1', 'diff.txt'), 'utf-8')
    expect(diff).toContain('exit')
    expect(fs.existsSync(path.join(evDir, 'fail1', 'stdout.raw.txt'))).toBe(true)
    expect(fs.existsSync(path.join(evDir, 'fail1', 'transcript.txt'))).toBe(true)
    expect(fs.existsSync(path.join(evDir, 'fail1', 'files.txt'))).toBe(true)
  })

  it('rolls up a section to the worst outcome across its scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'a.yaml',
      scenario({ id: 'a', binds: bindsFor('same/section'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'b.yaml',
      scenario({ id: 'b', binds: bindsFor('same/section'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.sections).toHaveLength(1)
    expect(res.latest.sections[0]).toMatchObject({ section: 'same/section', status: 'fail' })
    expect(res.latest.sections[0].scenarioIds.sort()).toEqual(['a', 'b'])
  })

  it('honors --scenario selection', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'a.yaml', scenario({ id: 'keep', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    writeScenario(r, 'b.yaml', scenario({ id: 'drop', steps: [{ run: ['whoami'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'keep' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios.map((s) => s.id)).toEqual(['keep'])
  })

  it('runs a step `repeat` times', async () => {
    const r = repo()
    writeRecipe(r)
    // First step ticks 3×; the follow-up tick must then read "tick 4".
    writeScenario(
      r,
      'repeat.yaml',
      scenario({
        id: 'repeat',
        steps: [
          { run: ['tick'], repeat: 3, expect: { exit: 0 } },
          { run: ['tick'], expect: { stdout: { contains: 'tick 4' } } },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'repeat' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('maps a timeout to an error outcome (never a fail)', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'hang.yaml', scenario({ id: 'hang', steps: [{ run: ['hang'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, stepTimeoutMs: 500 })
    if (res.status !== 'ok') throw new Error('expected ok')
    const hang = res.latest.scenarios[0]
    expect(hang.outcome).toBe('error')
    expect(hang.evidencePath).toBeTruthy()
    const diff = fs.readFileSync(path.join(evidenceRunDir(r, res.latest.run.runId), 'hang', 'diff.txt'), 'utf-8')
    expect(diff).toContain('timed out')
  })

  it('builds exactly once for the whole run', async () => {
    const r = repo()
    writeRecipe(r, { build: `node -e 'require("fs").appendFileSync("build-count.txt","x")'` })
    for (const id of ['s1', 's2', 's3']) {
      writeScenario(r, `${id}.yaml`, scenario({ id, steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    }
    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    expect(fs.readFileSync(path.join(r, 'build-count.txt'), 'utf-8')).toBe('x')
  })

  it('aborts the run when the build fails', async () => {
    const r = repo()
    writeRecipe(r, { build: 'exit 1' })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('build-failed')
    if (res.status === 'build-failed') expect(res.build.exitCode).not.toBe(0)
  })

  it('reports no-recipe / no-scenarios / unknown id', async () => {
    const noRecipe = repo()
    expect((await runGuard({ repoRoot: noRecipe, skipBuild: true })).status).toBe('no-recipe')

    const empty = repo()
    writeRecipe(empty)
    expect((await runGuard({ repoRoot: empty, skipBuild: true })).status).toBe('no-scenarios')

    const oneScenario = repo()
    writeRecipe(oneScenario)
    writeScenario(oneScenario, 's.yaml', scenario({ id: 'real', steps: [{ run: [], expect: { exit: 0 } }] }))
    const unknown = await runGuard({ repoRoot: oneScenario, skipBuild: true, scenarioId: 'ghost' })
    expect(unknown.status).toBe('no-scenarios')
    if (unknown.status === 'no-scenarios') expect(unknown.requestedId).toBe('ghost')
  })

  it('runs many scenarios in parallel and completes them all', async () => {
    const r = repo()
    writeRecipe(r)
    for (let i = 0; i < 6; i++) {
      writeScenario(r, `s${i}.yaml`, scenario({ id: `s${i}`, steps: [{ run: ['whoami'], expect: { exit: 0 } }] }))
    }
    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 4 })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.summary).toMatchObject({ total: 6, pass: 6 })
  })

  it('persists LATEST + a run snapshot + a history entry', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, branch: 'main', commit: 'abc123' })
    if (res.status !== 'ok') throw new Error('expected ok')

    const runId = res.latest.run.runId
    expect(fs.existsSync(guardLatestPath(r))).toBe(true)
    expect(fs.existsSync(guardRunPath(r, runId))).toBe(true)

    const history = readGuardHistory(r)
    expect(history.runs).toHaveLength(1)
    expect(history.runs[0]).toMatchObject({
      runId,
      branch: 'main',
      commit: 'abc123',
      summary: res.latest.summary,
    })
  })

  it('persist:false writes nothing to the store (birth-validation invariant)', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    if (res.status !== 'ok') throw new Error('expected ok')

    expect(res.latestPath).toBe('')
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
    expect(fs.existsSync(guardRunsDir(r))).toBe(false)
    expect(fs.existsSync(guardHistoryPath(r))).toBe(false)
    expect(readGuardHistory(r)).toEqual({ runs: [] })
  })

  it('materializes setup.git and a step observes the repo state', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'gitobs.yaml',
      scenario({
        id: 'gitobs',
        setup: {
          files: { 'README.md': '# hi\n', 'CHANGELOG.md': 'changes\n', 'draft.txt': 'wip\n' },
          git: {
            commits: [
              { files: ['README.md'], message: 'init' },
              { files: ['CHANGELOG.md'], message: 'changelog' },
            ],
            staged: ['draft.txt'],
          },
        },
        steps: [
          {
            run: ['gitstate'],
            expect: { exit: 0, stdout: { contains: 'repo=yes' } },
          },
          {
            run: ['gitstate'],
            expect: { stdout: { contains: 'staged=1' } },
          },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'gitobs' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('turns a git capability failure into an `error` outcome naming the capability', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'gitbad.yaml',
      scenario({
        id: 'gitbad',
        setup: {
          files: { 'README.md': '# hi\n' },
          // absent.txt was never seeded → materialization fails before any step.
          git: { commits: [{ files: ['absent.txt'] }] },
        },
        steps: [{ run: ['gitstate'], expect: { exit: 0 } }],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'gitbad' })
    if (res.status !== 'ok') throw new Error('expected ok')
    const gitbad = res.latest.scenarios[0]
    expect(gitbad.outcome).toBe('error')
    expect(gitbad.failure!.actual).toContain('setup.git')
    expect(gitbad.failure!.actual).toContain('absent.txt')
  })

  it('the env allowlist hides host vars from a scenario but delivers recipe/scenario/PATH', async () => {
    const r = repo()
    writeRecipe(r, { env: { RECIPE_VAR: 'from-recipe' } })
    process.env.GUARD_LEAK_TEST = 'leaked'
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak'
    try {
      writeScenario(
        r,
        'env.yaml',
        scenario({
          id: 'envcheck',
          setup: { env: { SCENARIO_VAR: 'from-scenario' } },
          steps: [
            { run: ['env', 'GUARD_LEAK_TEST'], expect: { stdout: { equals: 'GUARD_LEAK_TEST=(unset)\n' } } },
            { run: ['env', 'ANTHROPIC_API_KEY'], expect: { stdout: { contains: 'ANTHROPIC_API_KEY=(unset)' } } },
            { run: ['env', 'RECIPE_VAR'], expect: { stdout: { contains: 'RECIPE_VAR=from-recipe' } } },
            { run: ['env', 'SCENARIO_VAR'], expect: { stdout: { contains: 'SCENARIO_VAR=from-scenario' } } },
            { run: ['env', 'PATH'], expect: { stdout: { matches: 'PATH=\\S' } } },
          ],
        }),
      )
      const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'envcheck' })
      if (res.status !== 'ok') throw new Error('expected ok')
      expect(res.latest.scenarios[0].outcome).toBe('pass')
    } finally {
      delete process.env.GUARD_LEAK_TEST
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('seeds setup.files and lets a scenario read them', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'check.yaml',
      scenario({
        id: 'check',
        setup: { files: { '.relkitrc.json': '{"name":"seeded","strict":false}' } },
        steps: [
          {
            run: ['check'],
            expect: { exit: 0, stdout: { contains: 'seeded' }, files: { 'check-report.txt': { contains: 'name=seeded' } } },
          },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'check' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('pins the interpreter: a setup.env.PATH stub reaches child spawns but never the entrypoint node', async () => {
    // Live bug reproduction: a scenario legitimately overrides PATH to inject a
    // fake `claude` stub — and pre-fix that same override also swapped which `node`
    // ran the entrypoint (a crashing stub node resolved first). With entry[0] pinned
    // to an absolute host path at run start, the real node still runs the fixture CLI
    // while a CHILD lookup of `claude` on the scenario PATH sees the stub.
    const r = repo()
    const stubDir = path.join(r, 'stubbin')
    fs.mkdirSync(stubDir)
    // A fake `node` that would crash the entrypoint if PATH could swap the interpreter.
    fs.writeFileSync(path.join(stubDir, 'node'), '#!/bin/sh\necho "FAKE NODE ran the entrypoint" >&2\nexit 1\n')
    // A fake `claude` — the stub a scenario is entitled to inject for child processes.
    fs.writeFileSync(path.join(stubDir, 'claude'), '#!/bin/sh\necho "STUB_CLAUDE marker"\n')
    fs.chmodSync(path.join(stubDir, 'node'), 0o755)
    fs.chmodSync(path.join(stubDir, 'claude'), 0o755)

    writeRecipe(r, { entry: ['node', FIXTURE_BIN] })
    writeScenario(
      r,
      'pin.yaml',
      scenario({
        id: 'pin',
        // PATH is ONLY the stub dir: pre-fix, `node` would resolve to the crashing stub.
        setup: { env: { PATH: stubDir } },
        steps: [
          // Real node still runs the fixture → its own `--version` logic executes.
          { run: ['--version'], expect: { exit: 0, stdout: { matches: '^\\d+\\.\\d+\\.\\d+' } } },
          // A child `claude` spawned by the program DOES resolve to the injected stub.
          { run: ['run-child', 'claude'], expect: { exit: 0, stdout: { contains: 'STUB_CLAUDE marker' } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'pin' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('opts.concurrency overrides TRUECOURSE_MAX_CONCURRENCY (barrier scenarios pair up in parallel)', async () => {
    // Two scenarios each write a sentinel and block until the other's appears, with
    // a 5s poll cap. Concurrency ≥ 2 → both pair instantly; serial (concurrency 1) →
    // the first would block for its partner that never starts and time out. The env
    // demands serial, the explicit opts override demands parallel — opts must win.
    const r = repo()
    const coordDir = path.join(r, 'coord')
    fs.mkdirSync(coordDir)
    const coordinator = path.join(r, 'coordinator.sh')
    fs.writeFileSync(
      coordinator,
      '#!/bin/sh\nself="$1"; partner="$2"; dir="$3"\ntouch "$dir/$self"\ni=0\nwhile [ ! -f "$dir/$partner" ]; do i=$((i+1)); [ "$i" -gt 100 ] && { echo timeout >&2; exit 1; }; sleep 0.05; done\necho "paired $self $partner"\n',
    )
    fs.chmodSync(coordinator, 0o755)
    writeRecipe(r)
    writeScenario(
      r,
      'one.yaml',
      scenario({ id: 'one', steps: [{ run: ['run-child', coordinator, 'one', 'two', coordDir], expect: { exit: 0, stdout: { contains: 'paired one two' } } }] }),
    )
    writeScenario(
      r,
      'two.yaml',
      scenario({ id: 'two', steps: [{ run: ['run-child', coordinator, 'two', 'one', coordDir], expect: { exit: 0, stdout: { contains: 'paired two one' } } }] }),
    )

    process.env.TRUECOURSE_MAX_CONCURRENCY = '1'
    try {
      const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 2 })
      if (res.status !== 'ok') throw new Error('expected ok')
      expect(res.latest.summary).toMatchObject({ total: 2, pass: 2 })
    } finally {
      delete process.env.TRUECOURSE_MAX_CONCURRENCY
    }
  })
})

describe('defaultRunConcurrency', () => {
  const saved = process.env.TRUECOURSE_MAX_CONCURRENCY
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUECOURSE_MAX_CONCURRENCY
    else process.env.TRUECOURSE_MAX_CONCURRENCY = saved
  })

  it('defaults to min(cpus, 8) when the env var is unset', () => {
    delete process.env.TRUECOURSE_MAX_CONCURRENCY
    expect(defaultRunConcurrency()).toBe(Math.min(os.cpus().length, 8))
  })

  it('honors a positive integer TRUECOURSE_MAX_CONCURRENCY', () => {
    process.env.TRUECOURSE_MAX_CONCURRENCY = '16'
    expect(defaultRunConcurrency()).toBe(16)
  })

  it('ignores a non-positive or non-numeric value and falls back to the default', () => {
    for (const bad of ['0', '-4', 'abc', '']) {
      process.env.TRUECOURSE_MAX_CONCURRENCY = bad
      expect(defaultRunConcurrency()).toBe(Math.min(os.cpus().length, 8))
    }
  })
})
