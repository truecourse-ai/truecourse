import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, guardRunPath } from '@truecourse/guard-runner'
import { GuardLatestSchema, type GuardBinds, type GuardScenario } from '@truecourse/shared'
import { makeTempRepo, parseDocTree, rmrf, writeRecipe, writeScenario, scenario, specBinds, sectionBind, staleSpecBind } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** A bind one of whose sentences the doc no longer holds — an EDITED sentence. */
const staleBind = staleSpecBind

/** A bind to a document that is not in the repo — a REMOVED document. */
function orphanBind(doc: string): GuardBinds {
  return { doc, sentences: ['sentence:of-a-removed-doc'] }
}

/** A one-step passing scenario over the given binds. */
function passing(id: string, binds: GuardBinds[]): GuardScenario {
  return scenario({ id, binds, steps: [{ run: ['--version'], expect: { exit: 0 } }] })
}

// --- A doc this file owns, so its sentences can MOVE under other headings -----

const MOVE_DOC = 'docs/moving.md'
const MOVE_V1 = ['# Guide', '', '## Top', 'preamble', '', '### Limits', 'Five attempts.', '', '## Aside', 'unrelated'].join(
  '\n',
)

function writeMoveDoc(root: string, content: string): void {
  const target = path.join(root, MOVE_DOC)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** The live binding of the sentences under `headingText` in `content`. */
function moveBind(content: string, headingText: string): GuardBinds {
  const tree = parseDocTree(MOVE_DOC, content)
  const s = tree.sections.find((x) => x.headingText === headingText)
  if (!s) throw new Error(`no section "${headingText}"`)
  return sectionBind(tree, s.anchor)
}

describe('runGuard — plural-bind staleness', () => {
  it('runs a scenario whose every bind matches', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('all-match', specBinds('a/b', 'cli/version', 'cli/whoami')))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('is stale when ANY bind is stale, and never runs', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('second-stale', [specBinds('a/b')[0], staleBind('cli/version')]))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('stale')
    expect(s.durationMs).toBe(0)
    expect(s.evidencePath).toBeUndefined()
  })

  it('is orphaned only when EVERY bind is orphaned', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('all-gone', [orphanBind('docs/no-such.md'), orphanBind('docs/also-gone.md')]))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('orphaned')
    expect(res.latest.summary).toMatchObject({ orphaned: 1, stale: 0 })
  })

  it('is stale (not orphaned) when only SOME binds are orphaned', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('partial', [specBinds('a/b')[0], orphanBind('docs/no-such.md')]))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('stale')
  })

  it('is stale when an edited bind and a removed document mix', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('mixed', [orphanBind('docs/no-such.md'), staleBind('cli/version')]))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('stale')
  })

  it('still runs when a bind’s sentences moved under a renamed heading', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', passing('moved', [moveBind(MOVE_V1, 'Aside'), moveBind(MOVE_V1, 'Limits')]))
    // Rename the parent heading: the sentences under "Limits" stand, under a new anchor.
    writeMoveDoc(r, MOVE_V1.replace('## Top', '## Renamed'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })
})

describe('runGuard — flow annotations on results', () => {
  const flow = { id: 'publish-a-release', fingerprint: 'sha256:flow-fp' }

  it('carries flowId and the failing step’s milestone into LATEST and the run snapshot', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'flow/fail.yaml',
      scenario({
        id: 'publish-a-release.cli.1',
        flow,
        binds: specBinds('cli/version', 'cli/boom'),
        steps: [
          { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
          { run: ['boom'], expect: { exit: 0 }, milestone: 2 },
        ],
      }),
    )
    writeScenario(
      r,
      'flow/pass.yaml',
      scenario({
        id: 'publish-a-release.cli.2',
        flow,
        binds: specBinds('cli/whoami'),
        steps: [{ run: ['whoami'], expect: { exit: 0 }, milestone: 1 }],
      }),
    )
    // Hand-written: no flow, no milestones.
    writeScenario(
      r,
      'manual.yaml',
      scenario({ id: 'manual', binds: specBinds('a/b'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const failed = res.latest.scenarios.find((s) => s.id === 'publish-a-release.cli.1')!
    const passed = res.latest.scenarios.find((s) => s.id === 'publish-a-release.cli.2')!
    const manual = res.latest.scenarios.find((s) => s.id === 'manual')!

    expect(failed.outcome).toBe('fail')
    expect(failed.flowId).toBe('publish-a-release')
    expect(failed.failedMilestone).toBe(2)
    expect(passed.flowId).toBe('publish-a-release')
    expect(passed.failedMilestone).toBeUndefined()
    // A hand-written scenario belongs to no flow and annotates no milestone.
    expect(manual.outcome).toBe('fail')
    expect(manual.flowId).toBeUndefined()
    expect(manual.failedMilestone).toBeUndefined()

    // The annotations survive persistence — LATEST and the per-run snapshot.
    const latest = GuardLatestSchema.parse(JSON.parse(fs.readFileSync(res.latestPath, 'utf-8')))
    expect(latest.scenarios.find((s) => s.id === 'publish-a-release.cli.1')).toMatchObject({
      flowId: 'publish-a-release',
      failedMilestone: 2,
    })
    const snapshot = GuardLatestSchema.parse(
      JSON.parse(fs.readFileSync(guardRunPath(r, res.latest.run.runId), 'utf-8')),
    )
    expect(snapshot.scenarios.find((s) => s.id === 'publish-a-release.cli.1')?.failedMilestone).toBe(2)

    // The evidence transcript names the flow and every bind.
    const transcript = fs.readFileSync(path.join(r, failed.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('flow:     publish-a-release')
    expect(transcript.split('docs/spec.md (1 sentence)').length - 1).toBe(2)
  })

  it('annotates no milestone when the failing step is plumbing, and keeps flowId on a stale result', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'flow/plumbing.yaml',
      scenario({
        id: 'flow-a.cli.1',
        flow: { id: 'flow-a', fingerprint: 'sha256:a' },
        binds: specBinds('cli/boom'),
        // No `milestone` on the failing step — setup/plumbing paints neutral.
        steps: [{ run: ['boom'], expect: { exit: 0 } }],
      }),
    )
    writeScenario(
      r,
      'flow/stale.yaml',
      scenario({
        id: 'flow-b.cli.1',
        flow: { id: 'flow-b', fingerprint: 'sha256:b' },
        binds: [staleBind('cli/version')],
        steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const plumbing = res.latest.scenarios.find((s) => s.id === 'flow-a.cli.1')!
    const stale = res.latest.scenarios.find((s) => s.id === 'flow-b.cli.1')!
    expect(plumbing.outcome).toBe('fail')
    expect(plumbing.failedMilestone).toBeUndefined()
    expect(stale.outcome).toBe('stale')
    expect(stale.flowId).toBe('flow-b')
    // Nothing ran, so nothing failed at a milestone.
    expect(stale.failedMilestone).toBeUndefined()
  })
})
