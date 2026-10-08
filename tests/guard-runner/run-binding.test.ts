import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, evidenceRunDir } from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, parseDocTree, rmrf, writeRecipe, writeScenario, scenario, sectionBind, staleBind } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

// A doc path distinct from the shared spec doc `writeRecipe` seeds, so the
// missing-doc case below is genuinely missing.
const DOC = 'docs/rate.md'

function writeDoc(root: string, content: string): void {
  const target = path.join(root, DOC)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** A passing scenario (runs `--version`) bound to the sentences of a doc section. */
function boundScenario(id: string, content: string, headingText: string): GuardScenario {
  const tree = parseDocTree(DOC, content)
  const section = tree.sections.find((s) => s.headingText === headingText)
  if (!section) throw new Error(`no section "${headingText}"`)
  return scenario({
    id,
    binds: [sectionBind(tree, section.anchor)],
    steps: [{ run: ['--version'], expect: { exit: 0 } }],
  })
}

const DOC_V1 = ['# Spec', '', '## Top', 'preamble', '', '### Rate limiting', 'Login rate-limits after 5 attempts.'].join(
  '\n',
)

describe('runGuard — binding resolution', () => {
  it('executes a scenario whose bound sentences all stand (green)', async () => {
    const r = repo()
    writeRecipe(r)
    writeDoc(r, DOC_V1)
    writeScenario(r, 's.yaml', boundScenario('rate', DOC_V1, 'Rate limiting'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('pass')
    // An executed pass now carries its own evidence transcript.
    expect(s.evidencePath).toBeTruthy()
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1, stale: 0, orphaned: 0 })
  })

  it('marks a scenario stale when a bound sentence was edited, and never runs it', async () => {
    const r = repo()
    writeRecipe(r)
    // Bind against V1, then edit the bound sentence under the same heading.
    writeScenario(r, 's.yaml', boundScenario('rate', DOC_V1, 'Rate limiting'))
    writeDoc(r, DOC_V1.replace('after 5 attempts', 'after 10 attempts'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('stale')
    expect(s.durationMs).toBe(0) // not executed
    // A non-executed outcome has nothing to transcribe — no evidence pointer.
    expect(s.evidencePath).toBeUndefined()
    expect(fs.existsSync(evidenceRunDir(r, res.latest.run.runId))).toBe(false)
    expect(res.latest.summary.stale).toBe(1)
  })

  it('still runs a scenario whose sentences moved under other headings', async () => {
    const r = repo()
    writeRecipe(r)
    // Bind against V1 (Rate limiting under "Top").
    writeScenario(r, 's.yaml', boundScenario('rate', DOC_V1, 'Rate limiting'))
    // Rename both headings above the bound sentence — the sentence itself stands.
    writeDoc(r, DOC_V1.replace('## Top', '## Other').replace('### Rate limiting', '### Throttling'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
    expect(res.latest.summary).toMatchObject({ pass: 1, stale: 0, orphaned: 0 })
  })

  it('marks a scenario stale when its bound sentences were removed from a doc that stands', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', boundScenario('rate', DOC_V1, 'Rate limiting'))
    writeDoc(r, ['# Spec', '', '## Top', 'preamble only now'].join('\n'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('stale')
    // A scenario that never ran carries no evidence pointer.
    expect(res.latest.scenarios[0].evidencePath).toBeUndefined()
    expect(res.latest.summary).toMatchObject({ stale: 1, orphaned: 0 })
  })

  it('orphans a scenario whose bound doc is missing entirely', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', boundScenario('rate', DOC_V1, 'Rate limiting'))
    // Note: DOC is never written to disk.

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('orphaned')
    expect(res.latest.scenarios[0].evidencePath).toBeUndefined()
    expect(res.latest.summary.orphaned).toBe(1)
  })

  it('mixes executed and non-executed outcomes in one run', async () => {
    const r = repo()
    writeRecipe(r)
    writeDoc(r, DOC_V1)
    // One matches (green); one binds "spec/top" with a sentence the doc no longer holds.
    writeScenario(r, 'ok.yaml', boundScenario('green', DOC_V1, 'Rate limiting'))
    writeScenario(
      r,
      'stale.yaml',
      scenario({
        id: 'stale',
        binds: [staleBind(sectionBind(parseDocTree(DOC, DOC_V1), 'spec/top'))],
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 1, stale: 1 })
    const stale = res.latest.scenarios.find((s) => s.id === 'stale')!
    expect(stale.outcome).toBe('stale')
  })
})
