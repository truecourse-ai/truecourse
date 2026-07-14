import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, guardLatestPath, guardRunsDir } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Seed a script whose bare import crashes Node at startup (the live ERR_MODULE_NOT_FOUND). */
function writeCrashingEntry(r: string, rel = 'crash.mjs'): void {
  fs.writeFileSync(path.join(r, rel), "import 'tc-guard-nonexistent-module-xyz'\n")
}

describe('runGuard — entry pre-flight', () => {
  it('a build-succeeds-but-entry-crashes recipe fails with ONE entry-preflight error (no per-scenario failures)', async () => {
    const r = repo()
    writeRecipe(r, { build: 'true', entry: ['node', 'crash.mjs'] })
    writeCrashingEntry(r)
    // Two scenarios that WOULD each fail identically pre-fix — they must never run.
    writeScenario(r, 'v.yaml', scenario({ id: 'v', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    writeScenario(r, 'w.yaml', scenario({ id: 'w', binds: specBinds('cli/whoami'), steps: [{ run: ['whoami'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r })

    expect(res.status).toBe('entry-preflight-failed')
    if (res.status !== 'entry-preflight-failed') return
    expect(res.preflight.ok).toBe(false)
    expect(res.preflight.entry).toBe('node crash.mjs')
    // The FULL startup stderr, never truncated — the real cause, surfaced.
    expect(res.preflight.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/)
    expect(res.buildCommand).toBe('true')

    // NOTHING was written to the store and NO scenario outcome was produced.
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
    expect(fs.existsSync(guardRunsDir(r))).toBe(false)
  })

  it('an entry naming a NONEXISTENT script (cli.js vs cli.mjs mixup) fails preflight with the sibling listing', async () => {
    // The live production failure: recipe entry `dist/cli.js`, build produces
    // `dist/cli.mjs`. Node crashes MODULE_NOT_FOUND on every invocation; the crash
    // output embeds the sandbox cwd, which per-probe sandboxes turned into a fake
    // "reacted to argv" difference — the false-ALIVE this test pins down.
    const r = repo()
    fs.mkdirSync(path.join(r, 'dist'))
    fs.writeFileSync(path.join(r, 'dist', 'cli.mjs'), 'export {}\n')
    writeRecipe(r, { build: 'true', entry: ['node', 'dist/cli.js'] })
    writeScenario(r, 'v.yaml', scenario({ id: 'v', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r })

    expect(res.status).toBe('entry-preflight-failed')
    if (res.status !== 'entry-preflight-failed') return
    expect(res.preflight.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/) // real node stderr
    expect(res.preflight.stderr).toContain('entry file not found: dist/cli.js')
    expect(res.preflight.stderr).toContain('dist/ contains: cli.mjs') // the one-glance hint
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('an entry naming a missing ABSOLUTE script fails preflight', async () => {
    const r = repo()
    const abs = path.join(r, 'nowhere', 'cli.js') // never created
    writeRecipe(r, { build: 'true', entry: ['node', abs] })
    writeScenario(r, 'v.yaml', scenario({ id: 'v', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('entry-preflight-failed')
    if (res.status !== 'entry-preflight-failed') return
    expect(res.preflight.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/)
    expect(res.preflight.stderr).toContain('entry file not found')
  })

  it('a healthy entry that exits nonzero with usage on no-args passes preflight and runs scenarios', async () => {
    // relkit exits 64 on no-args AND on `--help`, but with DIFFERENT stderr — so the
    // preflight (which never string-matches) sees it react to argv and lets it run.
    const r = repo()
    writeRecipe(r) // default fixture entry, build `true`
    writeScenario(r, 'v.yaml', scenario({ id: 'v', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1 })
  })

  it('skipBuild (birth validation) never runs the preflight — it reuses the generator\'s', async () => {
    // A dead entry under skipBuild must NOT short-circuit here; birth owns the gate.
    const r = repo()
    writeRecipe(r, { entry: ['node', 'crash.mjs'] })
    writeCrashingEntry(r)
    writeScenario(r, 'v.yaml', scenario({ id: 'v', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const res = await runGuard({ repoRoot: r, skipBuild: true, persist: false })
    // The run proceeds to execute the (crashing) scenario, which errors as infra —
    // NOT an entry-preflight-failed short-circuit (that path is build-owned only).
    expect(res.status).toBe('ok')
  })
})
