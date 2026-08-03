/**
 * Per-step env (cli driver): a step's `env` is an overlay for THAT step's child
 * process only, layered on top of the scenario-global `setup.env`. Proves the merge
 * order, that siblings stay clean, that the allowlist still hides host vars, that
 * the pinned entry interpreter survives a step-level PATH override, and that the
 * evidence transcript records the declared overlay.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, evidenceRunDir, overlayStepEnv } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeScenario,
  scenario,
  FIXTURE_BIN,
  withPlantedSecrets,
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

describe('overlayStepEnv — the layering rule', () => {
  it('is the LAST layer and never mutates the scenario env', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/bin', SHARED: 'from-scenario', KEEP: 'k' }
    const overlaid = overlayStepEnv(base, { SHARED: 'from-step', STEP_ONLY: 's' })

    expect(overlaid.SHARED).toBe('from-step')
    expect(overlaid.STEP_ONLY).toBe('s')
    expect(overlaid.PATH).toBe('/bin')
    expect(overlaid.KEEP).toBe('k')
    // The scenario env is untouched — the next step gets it back verbatim.
    expect(base).toEqual({ PATH: '/bin', SHARED: 'from-scenario', KEEP: 'k' })
  })

  it('returns the base itself when the step declares nothing (today’s behaviour)', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/bin' }
    expect(overlayStepEnv(base, undefined)).toBe(base)
  })
})

describe('runGuard — per-step env overlay', () => {
  it('a step’s env wins for that step only: setup.env stays global, siblings run clean', async () => {
    const r = repo()
    writeRecipe(r, { env: { RECIPE_VAR: 'from-recipe', SHARED: 'from-recipe' } })
    writeScenario(
      r,
      'stepenv.yaml',
      scenario({
        id: 'stepenv',
        setup: { env: { SHARED: 'from-scenario', SCENARIO_VAR: 'from-scenario' } },
        steps: [
          // 1 — before the overlay: scenario beats recipe, the step-only name is unset.
          {
            run: ['env', 'SHARED', 'SCENARIO_VAR', 'RECIPE_VAR', 'STEP_ONLY'],
            expect: {
              exit: 0,
              stdout: {
                equals:
                  'SHARED=from-scenario\nSCENARIO_VAR=from-scenario\nRECIPE_VAR=from-recipe\nSTEP_ONLY=(unset)\n',
              },
            },
          },
          // 2 — the overlay: the step's own values win, everything else still applies.
          {
            run: ['env', 'SHARED', 'SCENARIO_VAR', 'RECIPE_VAR', 'STEP_ONLY'],
            env: { SHARED: 'from-step', STEP_ONLY: 'yes' },
            expect: {
              exit: 0,
              stdout: {
                equals:
                  'SHARED=from-step\nSCENARIO_VAR=from-scenario\nRECIPE_VAR=from-recipe\nSTEP_ONLY=yes\n',
              },
            },
          },
          // 3 — the NEXT step is unaffected: byte-identical to step 1.
          {
            run: ['env', 'SHARED', 'SCENARIO_VAR', 'RECIPE_VAR', 'STEP_ONLY'],
            expect: {
              exit: 0,
              stdout: {
                equals:
                  'SHARED=from-scenario\nSCENARIO_VAR=from-scenario\nRECIPE_VAR=from-recipe\nSTEP_ONLY=(unset)\n',
              },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'stepenv' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('a step env cannot re-admit host vars — the allowlist still holds', async () => {
    const r = repo()
    writeRecipe(r)
    await withPlantedSecrets(async () => {
      writeScenario(
        r,
        'hermetic.yaml',
        scenario({
          id: 'hermetic',
          steps: [
            {
              run: ['env', 'ANTHROPIC_API_KEY', 'DATABASE_URL', 'CI', 'DECLARED'],
              // Declaring one name admits exactly that name; the host's own CI=true
              // (planted) still never reaches the child.
              env: { DECLARED: 'only-this' },
              expect: {
                exit: 0,
                stdout: {
                  equals:
                    'ANTHROPIC_API_KEY=(unset)\nDATABASE_URL=(unset)\nCI=(unset)\nDECLARED=only-this\n',
                },
              },
            },
          ],
        }),
      )

      const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'hermetic' })
      if (res.status !== 'ok') throw new Error('expected ok')
      expect(res.latest.scenarios[0].outcome).toBe('pass')
    })
  })

  it('pins the interpreter under a STEP-level PATH override, and the override dies with the step', async () => {
    // The pinned-interpreter guarantee, per step: `entry[0]` is resolved to an absolute path at
    // run start, so a step's PATH edit reaches CHILD lookups (stub injection) but
    // never swaps the node running the entrypoint — and the next step's lookups see
    // the scenario PATH again.
    const r = repo()
    const stubDir = path.join(r, 'stubbin')
    fs.mkdirSync(stubDir)
    // A fake `node` that would crash the entrypoint if PATH could swap the interpreter.
    fs.writeFileSync(path.join(stubDir, 'node'), '#!/bin/sh\necho "FAKE NODE ran the entrypoint" >&2\nexit 1\n')
    // A stub reachable ONLY through the step's PATH override.
    fs.writeFileSync(path.join(stubDir, 'tcstubonly'), '#!/bin/sh\necho "STUB_ONLY marker"\n')
    fs.chmodSync(path.join(stubDir, 'node'), 0o755)
    fs.chmodSync(path.join(stubDir, 'tcstubonly'), 0o755)

    writeRecipe(r, { entry: ['node', FIXTURE_BIN] })
    writeScenario(
      r,
      'pinstep.yaml',
      scenario({
        id: 'pinstep',
        steps: [
          // PATH is ONLY the stub dir for this step: the real node still runs the
          // fixture (its own `--version` logic executes, the fake node never does).
          { run: ['--version'], env: { PATH: stubDir }, expect: { exit: 0, stdout: { matches: '^\\d+\\.\\d+\\.\\d+' } } },
          // A CHILD spawn on that same step's PATH does resolve to the stub.
          {
            run: ['run-child', 'tcstubonly'],
            env: { PATH: stubDir },
            expect: { exit: 0, stdout: { contains: 'STUB_ONLY marker' } },
          },
          // Without the overlay the stub is gone: the child lookup fails (exit 1),
          // proving the PATH edit never outlived its step.
          { run: ['run-child', 'tcstubonly'], expect: { exit: 1 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'pinstep' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('evidence records the declared overlay on the step that carries it, and nothing on its siblings', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'evid.yaml',
      scenario({
        id: 'evid',
        steps: [
          { run: ['env', 'MODE'], expect: { exit: 0 } },
          { run: ['env', 'MODE'], env: { MODE: 'ci' }, expect: { exit: 0, stdout: { equals: 'MODE=ci\n' } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: 'evid' })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')

    const dir = path.join(evidenceRunDir(r, res.latest.run.runId), 'evid')
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    expect(invocation.steps[0].env).toBeUndefined()
    expect(invocation.steps[1].env).toEqual({ MODE: 'ci' })

    // The human-readable transcript names the overlay next to the invocation.
    const transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('env:     MODE=ci')
  })
})
