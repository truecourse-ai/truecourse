import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isJourneyDrifted, runGuard, guardJourneysPath, readJourneyCatalog } from '@truecourse/guard-runner'
import { journeyFingerprint, type Journey, type JourneysFile } from '@truecourse/shared'
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

/** A cli journey over `command`, fingerprinted the way the mapper would. */
function journey(id: string, command: string[], flags: string[] = []): Journey {
  const shape = {
    type: 'cli' as const,
    entry: { command },
    steps: [{ kind: 'invoke' as const, command, flags }],
  }
  return { id, title: command.join(' '), ...shape, fingerprint: journeyFingerprint(shape) }
}

function writeCatalog(root: string, journeys: Journey[]): JourneysFile {
  const file: JourneysFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    recipeFingerprint: 'sha256:recipe',
    journeys,
  }
  fs.mkdirSync(path.dirname(guardJourneysPath(root)), { recursive: true })
  fs.writeFileSync(guardJourneysPath(root), JSON.stringify(file, null, 2))
  return file
}

const VERSION = journey('cli/version', ['relkit', 'version'])
const WHOAMI = journey('cli/whoami', ['relkit', 'whoami'])

describe('isJourneyDrifted', () => {
  const catalog: JourneysFile = {
    version: 1,
    generatedAt: 'now',
    recipeFingerprint: 'sha256:recipe',
    journeys: [VERSION, WHOAMI],
  }

  it('reports no drift when every embedded fingerprint still matches', () => {
    const ref = { path: ['cli/version', 'cli/whoami'], fingerprints: [VERSION.fingerprint, WHOAMI.fingerprint] }
    expect(isJourneyDrifted({ journey: ref }, catalog)).toBe(false)
  })

  it('reports drift when a fingerprint moved', () => {
    const ref = { path: ['cli/version'], fingerprints: ['sha256:authored-against-older-surface'] }
    expect(isJourneyDrifted({ journey: ref }, catalog)).toBe(true)
  })

  it('reports drift when a referenced journey id is gone', () => {
    const ref = { path: ['cli/removed'], fingerprints: [VERSION.fingerprint] }
    expect(isJourneyDrifted({ journey: ref }, catalog)).toBe(true)
  })

  it('reports drift when a ref has no fingerprint to check', () => {
    const ref = { path: ['cli/version', 'cli/whoami'], fingerprints: [VERSION.fingerprint] }
    expect(isJourneyDrifted({ journey: ref }, catalog)).toBe(true)
  })

  it('reports nothing without a catalog or without journey refs', () => {
    const ref = { path: ['cli/version'], fingerprints: ['sha256:whatever'] }
    expect(isJourneyDrifted({ journey: ref }, null)).toBe(false)
    expect(isJourneyDrifted({ journey: undefined }, catalog)).toBe(false)
  })
})

describe('readJourneyCatalog', () => {
  it('reads back a written catalog, and treats an absent or corrupt one as no knowledge', () => {
    const r = repo()
    expect(readJourneyCatalog(r)).toBeNull()
    writeCatalog(r, [VERSION])
    expect(readJourneyCatalog(r)?.journeys.map((j) => j.id)).toEqual(['cli/version'])
    fs.writeFileSync(guardJourneysPath(r), '{ not json')
    expect(readJourneyCatalog(r)).toBeNull()
  })
})

describe('runGuard — journey-drift annotation', () => {
  it('annotates drifted scenarios without changing any outcome', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [VERSION, WHOAMI])

    // Grounded on the CURRENT surface — no annotation.
    writeScenario(
      r,
      'fresh.yaml',
      scenario({
        id: 'fresh',
        binds: specBinds('cli/version'),
        journey: { path: ['cli/version'], fingerprints: [VERSION.fingerprint] },
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )
    // Grounded on a surface that has since moved — annotated, still executes green.
    writeScenario(
      r,
      'moved.yaml',
      scenario({
        id: 'moved',
        binds: specBinds('cli/whoami'),
        journey: { path: ['cli/whoami'], fingerprints: ['sha256:older-surface'] },
        steps: [{ run: ['whoami'], expect: { exit: 0 } }],
      }),
    )
    // Grounded on a journey the mapping no longer knows — annotated too.
    writeScenario(
      r,
      'gone.yaml',
      scenario({
        id: 'gone',
        binds: specBinds('a/b'),
        journey: { path: ['cli/deleted'], fingerprints: [VERSION.fingerprint] },
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )
    // Hand-written: no journey refs, nothing to compare.
    writeScenario(
      r,
      'manual.yaml',
      scenario({ id: 'manual', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    // A drifted scenario whose SPEC also drifted keeps the annotation next to `stale`.
    writeScenario(
      r,
      'stale.yaml',
      scenario({
        id: 'stale',
        binds: [{ doc: specBinds('a/b')[0].doc, section: 'cli/version', fingerprint: 'sha256:older-text' }],
        journey: { path: ['cli/version'], fingerprints: ['sha256:older-surface'] },
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const by = new Map(res.latest.scenarios.map((s) => [s.id, s]))

    expect(by.get('fresh')).toMatchObject({ outcome: 'pass' })
    expect(by.get('fresh')!.journeyDrifted).toBeUndefined()
    expect(by.get('moved')).toMatchObject({ outcome: 'pass', journeyDrifted: true })
    expect(by.get('gone')).toMatchObject({ outcome: 'pass', journeyDrifted: true })
    expect(by.get('manual')!.journeyDrifted).toBeUndefined()
    expect(by.get('stale')).toMatchObject({ outcome: 'stale', journeyDrifted: true })
    // Drift is never counted as a failure.
    expect(res.latest.summary).toMatchObject({ total: 5, pass: 4, fail: 0, stale: 1 })
  })

  it('annotates nothing when no mapping snapshot exists', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'grounded.yaml',
      scenario({
        id: 'grounded',
        binds: specBinds('cli/version'),
        journey: { path: ['cli/version'], fingerprints: ['sha256:whatever'] },
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0]).toMatchObject({ outcome: 'pass' })
    expect(res.latest.scenarios[0].journeyDrifted).toBeUndefined()
  })
})
