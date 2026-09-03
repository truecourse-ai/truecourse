/**
 * Persisted coverage-gap sections (`manifest.gapSections`): a completed
 * generate records every live section no flow binds, so the next planner can
 * tell "seen and deliberately uncovered" from "never seen". Before this record
 * existed the verdicts lived only in the gitignored run report, so every
 * uncovered section re-entered the work set on every generate — at an
 * unchanged commit, forever.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { planGuardWork } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractSessionBy,
  runGenerate,
  submitWorkerSessions,
  PASSING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

async function generateOnce(r: string): Promise<void> {
  const res = await runGenerate({
    repoRoot: r,
    extractSession: extractSessionBy({ background: { untestable: 'design history, nothing observable' } }),
    flowWorkerSession: submitWorkerSessions(() => raw('relkit --version prints the version', PASSING_STEPS)),
  })
  expect(res.status).toBe('ok')
}

describe('gap sections — the persisted no-coverage record', () => {
  it('a completed generate pins uncovered sections, making the next plan a true no-op', async () => {
    const r = seed()
    await generateOnce(r)

    const manifest = readManifest(r)!
    const gaps = manifest.gapSections ?? []
    expect(gaps.some((g) => g.anchor === 'background')).toBe(true)
    // Flow-bound sections are never doubled into the gap record.
    expect(gaps.some((g) => g.anchor === 'version')).toBe(false)

    // The acceptance criterion this record exists for: at unchanged inputs the
    // planner finds NOTHING to do — bound sections match their bindings,
    // uncovered ones match their pins.
    expect(planGuardWork(r).work).toEqual([])
  }, 60_000)

  it('editing a pinned section re-admits exactly that section as work', async () => {
    const r = seed()
    await generateOnce(r)
    expect(planGuardWork(r).work).toEqual([])

    writeDoc(
      r,
      DOC,
      DOC_CONTENT.replace('The history of relkit', 'The REWRITTEN history of relkit'),
    )
    const work = planGuardWork(r).work
    expect(work.map((s) => s.anchor)).toEqual(['background'])
  }, 60_000)

  it('editing a flow-bound section still re-admits it through the binding gate', async () => {
    const r = seed()
    await generateOnce(r)

    writeDoc(r, DOC, DOC_CONTENT.replace('prints the version', 'prints the SEMVER version'))
    const work = planGuardWork(r).work
    expect(work.map((s) => s.anchor)).toEqual(['version'])
  }, 60_000)

  it('a vanished section drops out of the gap record on the next completed generate', async () => {
    const r = seed()
    await generateOnce(r)
    // Remove the uncovered section entirely; the next generate's record must
    // not carry a pin for a section that no longer exists.
    writeDoc(r, DOC, DOC_CONTENT.split('\n').slice(0, 2).join('\n'))
    await generateOnce(r)

    const gaps = readManifest(r)!.gapSections ?? []
    expect(gaps.some((g) => g.anchor === 'background')).toBe(false)
  }, 60_000)
})
