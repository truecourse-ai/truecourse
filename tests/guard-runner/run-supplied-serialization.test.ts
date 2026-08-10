/**
 * SHARED-WORLD SERIALIZATION.
 *
 * A supplied dependency registered as a PATH is not a value — it is a world. Two
 * scenarios binding the same registered instance each get their own sandbox COPY,
 * but the copy carries the instance's real-world footprint with it: the ports its
 * compose file publishes, the database those ports front, the on-disk locks its
 * tooling takes. Overlapping them is the field defect that produced
 * `AggregateError [ECONNREFUSED]`, a server that "crashes before it runs", and a
 * teardown in one sandbox stranding another mid-run.
 *
 * So the runner must never overlap two scenarios that bind the same supplied PATH
 * dependency — while keeping full parallelism everywhere else: across different
 * path dependencies, for scenarios that bind none, and for `env`-kind supplies
 * (a key or a token is a VALUE, and two scenarios reading the same key contend
 * for nothing).
 *
 * The probe is the fixture CLI's `hold` command: it registers a live marker in
 * TC_CLI_HOLD_DIR, samples how many markers are live at that instant into
 * TC_CLI_HOLD_SAMPLES, sleeps, then clears its marker. The peak sample IS the
 * observed overlap — 1 means the scenarios' execution windows were disjoint.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
const dirs: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  while (dirs.length) rmrf(dirs.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
function tmpdir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(d)
  return d
}

function writeCatalog(r: string, dependencies: unknown[]): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ dependencies }, null, 2))
}

function writeLocal(r: string, local: unknown): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.local.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(local, null, 2))
}

/** A `path`-registered supplied entry plus a real host directory to register for it. */
function pathDependency(r: string, name: string): Record<string, unknown> {
  const host = path.join(r, `instance-${name}`)
  fs.mkdirSync(host, { recursive: true })
  fs.writeFileSync(path.join(host, 'marker.txt'), name)
  return {
    entry: {
      name,
      class: 'supplied',
      summary: `a real ${name} to drive`,
      registration: { kind: 'path', description: `path to a checked-out ${name}` },
      needs: [{ flowId: 'f', need: `a real ${name}` }],
    },
    local: { path: host },
  }
}

/** A scenario whose single step holds a live marker in `holdDir` for `ms`. */
function holdScenario(id: string, needs: string[], holdDir: string, samples: string, ms = 500) {
  return scenario({
    id,
    binds: specBinds('cli/version'),
    ...(needs.length ? { needs } : {}),
    setup: {
      env: { TC_CLI_HOLD_DIR: holdDir, TC_CLI_HOLD_SAMPLES: samples, TC_CLI_HOLD_MS: String(ms) },
    },
    steps: [{ run: ['hold'], timeoutMs: 30_000, expect: { exit: 0, stdout: { contains: 'held' } } }],
  })
}

/** The largest simultaneous-liveness sample the probe recorded. */
function peak(samplesFile: string): number {
  const raw = fs.readFileSync(samplesFile, 'utf-8').split('\n').filter(Boolean).map(Number)
  return Math.max(...raw)
}

describe('runGuard — scenarios sharing a supplied PATH instance', () => {
  it('never overlaps them, even at concurrency 4', async () => {
    const r = repo()
    writeRecipe(r)
    const target = pathDependency(r, 'analysis-target')
    writeCatalog(r, [target.entry])
    writeLocal(r, { 'analysis-target': target.local })

    const holdDir = tmpdir('tc-shared-world-')
    const samples = path.join(tmpdir('tc-shared-samples-'), 'samples.txt')
    for (const id of ['a', 'b', 'c']) {
      writeScenario(r, `${id}.yaml`, holdScenario(id, ['analysis-target'], holdDir, samples))
    }

    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 4 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.summary).toMatchObject({ total: 3, pass: 3 })
    // The whole point: one world, one scenario in it at a time.
    expect(peak(samples)).toBe(1)
  }, 60_000)

  it('still runs scenarios binding DIFFERENT path instances in parallel', async () => {
    const r = repo()
    writeRecipe(r)
    const one = pathDependency(r, 'target-one')
    const two = pathDependency(r, 'target-two')
    writeCatalog(r, [one.entry, two.entry])
    writeLocal(r, { 'target-one': one.local, 'target-two': two.local })

    const holdDir = tmpdir('tc-two-worlds-')
    const samples = path.join(tmpdir('tc-two-samples-'), 'samples.txt')
    writeScenario(r, 'one.yaml', holdScenario('one', ['target-one'], holdDir, samples))
    writeScenario(r, 'two.yaml', holdScenario('two', ['target-two'], holdDir, samples))
    // A scenario binding nothing is not serialized against anything either.
    writeScenario(r, 'free.yaml', holdScenario('free', [], holdDir, samples))

    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 4 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.summary).toMatchObject({ total: 3, pass: 3 })
    expect(peak(samples)).toBeGreaterThan(1)
  }, 60_000)

  it('does not serialize on a shared env-kind supply — a key is a value, not a world', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [
      {
        name: 'llm-credentials',
        class: 'supplied',
        summary: 'an API key',
        registration: {
          kind: 'env',
          vars: [{ name: 'SOME_API_KEY', description: 'the key', secret: true }],
        },
        needs: [{ flowId: 'f', need: 'a working key' }],
      },
    ])
    writeLocal(r, { 'llm-credentials': { env: { SOME_API_KEY: 'sk-test' } } })

    const holdDir = tmpdir('tc-env-supply-')
    const samples = path.join(tmpdir('tc-env-samples-'), 'samples.txt')
    for (const id of ['a', 'b']) {
      writeScenario(r, `${id}.yaml`, holdScenario(id, ['llm-credentials'], holdDir, samples))
    }

    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 4 })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 2 })
    expect(peak(samples)).toBeGreaterThan(1)
  }, 60_000)
})
