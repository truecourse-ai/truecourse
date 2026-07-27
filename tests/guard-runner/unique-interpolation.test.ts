import { describe, it, expect, afterEach } from 'vitest'
import { runGuard } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('runGuard — the `${unique}` scenario variable', () => {
  it('interpolates `${unique}` in cli argv and stdin', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique.yaml',
      scenario({
        id: 'uni-cli',
        binds: specBinds('cli/version'),
        steps: [
          // argv: an unknown command echoes back the token → proves argv substitution.
          { run: ['${unique}'], expect: { exit: 64, stderr: { matches: 'unknown command: [a-z0-9]{8,12}' } } },
          // stdin: `shout` uppercases stdin → proves stdin substitution.
          { run: ['shout'], stdin: '${unique}', expect: { exit: 0, stdout: { matches: '^[A-Z0-9]{8,12}$' } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in an `expect.files` PATH (the map key)', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique-expect-files.yaml',
      scenario({
        id: 'uni-expect-files',
        binds: specBinds('cli/version'),
        steps: [
          {
            // The step creates the file from an INTERPOLATED argv; the assertion names
            // the same path. A verbatim key would look for a literal `${unique}`
            // filename and report the file missing.
            run: ['note', 'out-${unique}.txt', 'hello ${unique}'],
            expect: {
              exit: 0,
              files: { 'out-${unique}.txt': { exists: true, equals: 'hello ${unique}' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].failure?.actual).toBeUndefined()
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in `setup.files` paths and content', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique-setup-files.yaml',
      scenario({
        id: 'uni-setup-files',
        binds: specBinds('cli/version'),
        setup: { files: { 'seed-${unique}.txt': 'seeded ${unique}\n' } },
        steps: [
          // argv is interpolated, so the seeded path must be too — otherwise the
          // token lands on disk verbatim and this read misses the file.
          {
            run: ['show', 'seed-${unique}.txt'],
            expect: { exit: 0, stdout: { equals: 'seeded ${unique}\n' } },
          },
          // And the seeded path is assertable by the same name.
          {
            run: ['version'],
            expect: { exit: 0, files: { 'seed-${unique}.txt': { exists: true } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].failure?.actual).toBeUndefined()
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in the git capability’s staged paths', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique-setup-git.yaml',
      scenario({
        id: 'uni-setup-git',
        binds: specBinds('cli/version'),
        setup: {
          files: { 'draft-${unique}.txt': 'wip\n' },
          // The staged list names a `setup.files` path; both resolve together or the
          // capability stages a path that does not exist (a setup error).
          git: { staged: ['draft-${unique}.txt'] },
        },
        steps: [{ run: ['gitstate'], expect: { exit: 0, stdout: { contains: 'staged=1' } } }],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].failure?.actual).toBeUndefined()
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in setup + step env values', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unique-env.yaml',
      scenario({
        id: 'uni-env',
        binds: specBinds('cli/version'),
        setup: { env: { TC_SCENARIO_TAG: 'scenario-${unique}' } },
        steps: [
          { run: ['env', 'TC_SCENARIO_TAG'], expect: { exit: 0, stdout: { matches: '^TC_SCENARIO_TAG=scenario-[a-z0-9]{8,12}\\n' } } },
          {
            env: { TC_STEP_TAG: 'step-${unique}' },
            run: ['env', 'TC_STEP_TAG'],
            expect: { exit: 0, stdout: { matches: '^TC_STEP_TAG=step-[a-z0-9]{8,12}\\n' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].failure?.actual).toBeUndefined()
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('interpolates `${unique}` in an api request path', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/unique.yaml',
      apiScenario({
        id: 'uni-api',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/echo/${unique}' },
            // The echo endpoint reflects the interpolated path — a bare `${unique}`
            // would have thrown UnknownVariableError; a token proves it was seeded.
            expect: { status: 200, json: { path: { matches: '^/echo/[a-z0-9]{8,12}$' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)
})
