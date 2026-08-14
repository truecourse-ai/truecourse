import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  generateGuards,
  birthValidate,
  spawnGenerateRunner,
  retryCacheKey,
  type GenerateRunner,
  type ExtractRunner,
  type BirthCandidate,
  type AuthorUserContext,
  type ProbeTranscript,
} from '@truecourse/guard-generator'
import type { GuardBirthFinding, GuardFlow, Interface } from '@truecourse/shared'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  loadScenarios,
  readManifest,
  writeManifest,
  scenariosDir,
  dismissGuardClaim,
  defaultGuardExecutor,
  loadRecipe,
  recipePath,
  type GuardExecutor,
} from '@truecourse/guard-runner'
import {
  GuardManifestSchema,
  GuardGenerateReportSchema,
    guardManifestSections,
  isCompositionFinding,
  unaccountedSurfaces,
  violatesSettleInvariant,
  type GuardScenario,
} from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  bindsFor,
  raw,
  extractBy,
  authorBy,
  runGenerate,
  flowOfAll,
  flowPerClaim,
  matchAll,
  matchBy,
  cliInterface,
  interfacesOf,
  stampMilestones,
  PASSING_STEPS,
  FAILING_STEPS,
  writeScenarioFile,
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

/** The manifest's per-section view — the flow-keyed file projected at read time. */
function manifestSections(repoRoot: string) {
  return guardManifestSections(readManifest(repoRoot))
}

/** The manifest entry for one flow — the v2 unit. */
function flowEntry(repoRoot: string, flowId: string) {
  return readManifest(repoRoot)?.flows.find((f) => f.flowId === flowId)
}

const DOC = 'docs/cli.md'
// Two top-level (H2) sections: one CLI-testable, one background prose.
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

// Two CLI-testable sections — for isolating a per-flow authoring failure.
const TWO_CLI_DOC = 'docs/two.md'
const TWO_CLI_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## help',
  '`relkit --version` also answers here and exits 0.',
].join('\n')

/** version testable, background untestable — the honesty baseline. */
const versionCliBgUntestable = extractBy({ background: { untestable: 'design history, nothing observable' } })

/** Seed the standard one-doc repo. */
function seed(content = DOC_CONTENT, areaTags?: string[]): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, ...(areaTags ? { areaTags } : {}) }])
  writeDoc(r, DOC, content)
  return r
}

describe('generateGuards — extraction honesty + gaps', () => {
  it('records untestable sections as coverage gaps and guards the rest', async () => {
    const r = seed(DOC_CONTENT, ['tools/relkit'])

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('relkit --version prints the version', PASSING_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    const gap = res.coverageGaps.find((g) => g.anchor === 'background')!
    expect(gap.kind).toBe('untestable')
    expect(gap.reason).toMatch(/history/)

    // The guarded section is reachable through its flow; the untestable one binds
    // no flow at all, which is exactly what makes it a visible gap.
    const manifest = manifestSections(r)
    expect(manifest.find((s) => s.anchor === 'background')).toBeUndefined()
    const ver = manifest.find((s) => s.anchor === 'version')!
    expect(ver.scenarioIds).toEqual(['version'])
    expect(ver.flowIds).toEqual(['version'])
  })

  it('records an api-driver claim as blocked-on when the recipe has no api block', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ driver: 'api', reason: 'returns a 200 with the version body' }],
        background: { untestable: 'history' },
      }),
    })

    // The api driver is runnable, but THIS recipe carries no api preparation — the
    // claim is an honest blocked-on gap, never composed into a flow that could only
    // die at birth.
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('blocked-on')
    expect(gap.reason).toContain('a recipe `api` block')
  })

  it('records a library-driver claim (programmatic API) as an awaiting-driver gap', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ driver: 'library', reason: 'register() hooks the loader when imported from user code' }],
        background: { untestable: 'history' },
      }),
    })

    // No scenario is authored for an import-by-name programmatic API until the
    // library driver ships — the claim surfaces as an honest awaiting gap.
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('awaiting-driver')
    expect(gap.driver).toBe('library')
  })
})

describe('generateGuards — realization gaps', () => {
  it('an EMPTY surface catalog settles as a `no-interface` gap on the flow, never a refusal', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r), // the mapper found nothing
      extractRunner: versionCliBgUntestable,
      matchRunner: async () => {
        throw new Error('matching must never run against an empty catalog')
      },
    })

    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.kind === 'no-interface')!
    expect(gap.flowId).toBe('version')
    expect(gap.surface).toBe('cli')
    expect(gap.reason).toContain('no cli interface was mapped')
    // The manifest records it per surface, so the flow reads as accounted-for.
    expect(flowEntry(r, 'version')?.gaps).toEqual([
      { surface: 'cli', kind: 'no-interface', reason: gap.reason },
    ])
    expect(res.interfaces).toEqual({ total: 0, bySurface: {} })
  })

  it('a matcher refusal settles as an `unrealizable` gap carrying its stated reason', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      matchRunner: matchBy({ version: 'no interface prints a version — the catalog only lists `boom`' }),
    })

    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.kind === 'unrealizable')!
    expect(gap.flowId).toBe('version')
    expect(gap.reason).toContain('the catalog only lists `boom`')
    expect(flowEntry(r, 'version')?.generationInputsHash).not.toBeNull() // settled, not blocked
    expect(res.flows.settled).toBe(1)
  })

  it('a milestone no interface realizes is unrealizable after ONE corrective re-ask', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))
    let calls = 0

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      flowsRunner: flowOfAll('the two-step path'),
      // The plan covers the first milestone and nothing else; the engine re-asks
      // once, then settles the STATED signal rather than authoring against a plan
      // that walks only half the path.
      matchRunner: async (ctx) => {
        calls++
        return { plan: [{ interfaceId: ctx.interfaces[0].id, milestone: 1 }] }
      },
    })

    expect(calls).toBe(2) // the call + exactly one corrective re-ask
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.kind === 'unrealizable')!
    expect(gap.reason).toContain('no interface realizes milestone 2')
  })

  it('a surface with interfaces but no driver yet is an awaiting-driver gap on the flow', async () => {
    const r = seed()
    const webInterface: Interface = {
      id: 'web/board',
      type: 'web',
      title: 'Board',
      entry: { command: ['/'] },
      steps: [{ kind: 'navigate', route: '/' }],
      fingerprint: 'sha256:web',
    }

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['relkit']), webInterface),
      extractRunner: versionCliBgUntestable,
    })

    // cli still guards it; web is recorded as realizable-but-unrunnable.
    expect(res.written.map((w) => w.surface)).toEqual(['cli'])
    const gap = res.coverageGaps.find((g) => g.kind === 'awaiting-driver' && g.flowId === 'version')!
    expect(gap.surface).toBe('web')
    expect(gap.driver).toBe('web')
    expect(gap.reason).toContain('Needs web driver')
  })
})

describe('generateGuards — blocked-on world-state gaps', () => {
  it('records a blocked-on gap with normalized capabilities', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      // The flow needs world-state the sandbox can't express — no scenario, a reason.
      generateRunner: authorBy({ version: { blockedOn: ['Git', ' git ', 'DB'] } }),
    })

    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.flowId).toBe('version')
    // lowercased, trimmed, deduped → "git, db".
    expect(gap.reason).toBe('blocked on git, db: version')

    // The flow still SETTLES — it is accounted for, not left to re-run forever.
    const entry = flowEntry(r, 'version')!
    expect(entry.scenarios).toEqual([])
    expect(entry.gaps.map((g) => g.kind)).toEqual(['blocked-on'])
    expect(entry.generationInputsHash).not.toBeNull()
    // …and the interfaces its plan matched are PERSISTED even though no scenario
    // was written, so the interfaces view can say "used by <flow> — blocked" rather
    // than "the spec never mentions this code path".
    expect(entry.interfaces).toEqual([{ surface: 'cli', interfaceIds: ['cli/relkit'] }])
  })

  it('persists the matched interfaces for an AUTHORED flow too', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('relkit --version', PASSING_STEPS) }),
    })

    const entry = flowEntry(r, 'version')!
    expect(entry.scenarios.map((s) => s.drivers)).toEqual([['cli']])
    expect(entry.interfaces).toEqual([{ surface: 'cli', interfaceIds: ['cli/relkit'] }])
  })

  it('carries the matched interfaces forward on a no-op (unchanged) re-generate', async () => {
    const r = seed()
    const opts = {
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: { blockedOn: ['db'] } }),
    }
    await runGenerate(opts)
    const second = await runGenerate(opts)

    // Nothing re-authored — the entry is rewritten from the cached match verdict,
    // so the plan record must survive the cache-hit path.
    expect(second.flows.skipped).toBe(1)
    expect(flowEntry(r, 'version')!.interfaces).toEqual([{ surface: 'cli', interfaceIds: ['cli/relkit'] }])
  })

  it('carries the AUTHOR-stage gap forward on a no-op re-generate', async () => {
    const r = seed()
    const opts = {
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: { blockedOn: ['db'] } }),
    }
    await runGenerate(opts)
    const before = flowEntry(r, 'version')!
    expect(before.gaps.map((g) => g.kind)).toEqual(['blocked-on'])

    const second = await runGenerate(opts)

    // The refusal was settled by AUTHORING, which does not run for an unchanged
    // flow — only the MATCH-stage gaps are re-derivable. Re-deriving the entry from
    // this run alone would keep the hash (skipping the flow forever) while erasing
    // the reason: a settled flow with no test and no gap, healed by nothing.
    expect(second.flows.skipped).toBe(1)
    const after = flowEntry(r, 'version')!
    expect(after.gaps).toEqual(before.gaps)
    expect(after.generationInputsHash).toBe(before.generationInputsHash)
    expect(unaccountedSurfaces(after)).toEqual([])
    // The report says it too, so the dashboard's gap does not vanish on a no-op run.
    expect(second.coverageGaps.find((g) => g.kind === 'blocked-on')?.flowId).toBe('version')
  })

  it('re-runs a settled flow whose planned surface accounts for nothing (heal)', async () => {
    const r = seed()
    let authorCalls = 0
    const opts = {
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: { blockedOn: ['db'] } }, () => authorCalls++),
    }
    await runGenerate(opts)
    authorCalls = 0

    // The hole an earlier generate left behind: a plan, a hash — and neither a test
    // nor a gap to account for the surface it planned.
    const manifest = readManifest(r)!
    writeManifest(r, { ...manifest, flows: manifest.flows.map((f) => ({ ...f, gaps: [] })) })
    expect(violatesSettleInvariant(readManifest(r)!.flows[0])).toBe(true)

    const res = await runGenerate(opts)

    // Its hash is disregarded — the entry is WORK again, and the authoring cache
    // makes the re-run free, so an existing hole costs nothing to close.
    expect(res.flows.skipped).toBe(0)
    expect(authorCalls).toBe(0)
    const healed = flowEntry(r, 'version')!
    expect(healed.gaps.map((g) => g.kind)).toEqual(['blocked-on'])
    expect(healed.generationInputsHash).not.toBeNull()
    expect(violatesSettleInvariant(healed)).toBe(false)
  })

  it('never settles a flow in silence — every planned surface accounts for itself', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      // One flow authors a test, the other refuses — both must settle accounted for.
      generateRunner: authorBy({
        version: raw('relkit --version', PASSING_STEPS),
        help: { blockedOn: ['db'] },
      }),
    })

    const flows = readManifest(r)!.flows
    expect(flows.map((f) => f.flowId).sort()).toEqual(['help', 'version'])
    expect(flows.filter((f) => violatesSettleInvariant(f))).toEqual([])
  })

  it('an authored scenario wins over a stray blockedOn list', async () => {
    const r = seed()

    const runner: GenerateRunner = async (ctx) => ({
      scenario: stampMilestones(raw('v', PASSING_STEPS), ctx.milestones.length),
      blockedOn: ['db'],
    })

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.coverageGaps.some((g) => g.kind === 'blocked-on')).toBe(false)
  })

  it('a reply with neither a scenario nor a blockedOn is re-asked once, then errors', async () => {
    const r = seed()
    let calls = 0
    const runner: GenerateRunner = async () => {
      calls++
      return {} // says nothing: neither an authored scenario nor an honest refusal
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(calls).toBe(2) // the call + one corrective re-ask
    expect(res.written).toEqual([])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    // The repo's ONLY authoring call came back unusable, so the run aborts rather
    // than reporting an empty settle: nothing is recorded at all, and the flow is
    // work again next generate (the per-flow unsettle is covered by
    // llm-failure-accounting's half-bad run, where a sibling flow does land).
    expect(res.status).toBe('llm-failed')
    expect(readManifest(r)).toBeNull()
  })

  it('replays the blocked-on gap from the authoring cache without re-authoring', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: { blockedOn: ['db'] } }),
    })

    // Reset the manifest so the flow is work again; authoring is a cache HIT.
    writeManifest(r, { flows: [] })
    let authorCalls = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: { blockedOn: ['db'] } }, () => authorCalls++),
    })

    expect(authorCalls).toBe(0) // served from the per-(flow, surface) authoring cache
    expect(res2.coverageGaps.find((g) => g.kind === 'blocked-on')?.reason).toBe('blocked on db: version')
  })
})

describe('generateGuards — change detection', () => {
  it('does zero LLM work on a second run with an unchanged corpus', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    let extractCalls = 0
    let flowCalls = 0
    let matchCalls = 0
    let authorCalls = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'bg' } }, () => extractCalls++),
      flowsRunner: flowPerClaim(() => flowCalls++),
      matchRunner: matchAll(() => matchCalls++),
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => authorCalls++),
    })

    expect(res2.noChanges).toBe(true)
    expect(res2.written).toEqual([])
    expect([extractCalls, flowCalls, matchCalls, authorCalls]).toEqual([0, 0, 0, 0])
    // The flow is skipped, not re-settled: its committed scenario stands.
    expect(res2.flows).toMatchObject({ total: 1, skipped: 1, settled: 1, unsettled: 0 })
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
  })

  it('re-authors from the cache without a second authoring call', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    // Force the whole pipeline to re-run (fresh manifest) with the same doc:
    // synthesis + matching + authoring are all cache HITS.
    writeManifest(r, { flows: [] })
    let authorCalls = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => authorCalls++),
    })

    expect(res2.written.map((w) => w.flowId)).toEqual(['version'])
    expect(authorCalls).toBe(0)
  })

  it('a MOVED interface re-authors only the flow that grounds on it', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    // Two flows, each matched to its OWN interface.
    const twoInterfaces = [cliInterface(['relkit', 'version']), cliInterface(['relkit', 'help'])]
    const perFlow = async (ctx: Parameters<ReturnType<typeof matchAll>>[0]) => ({
      plan: ctx.milestones.map((m) => ({
        interfaceId: ctx.interfaces.find((j) => j.id.endsWith(ctx.flow.id))?.id ?? ctx.interfaces[0].id,
        milestone: m.order,
      })),
    })

    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, ...twoInterfaces),
      extractRunner: extractBy({}),
      matchRunner: perFlow,
    })

    // `version`'s interface gained a flag; `help`'s is untouched.
    let authored: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['relkit', 'version'], ['--json']), twoInterfaces[1]),
      extractRunner: extractBy({}),
      matchRunner: perFlow,
      generateRunner: authorBy({}, (ctx) => authored.push(ctx.flow.id)),
    })

    expect(authored).toEqual(['version'])
    expect(res.flows).toMatchObject({ total: 2, skipped: 1 })
  })
})

describe('generateGuards — the committed scenario', () => {
  it('writes valid YAML carrying the flow, the interface path, and every bound section', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    // The model returns a WRONG binding; the engine must overwrite it.
    const wrong = raw('walks both', [...PASSING_STEPS, ...PASSING_STEPS], {
      // @ts-expect-error — passthrough tolerates (and ignores) engine-owned fields
      binds: { doc: 'other.md', section: 'nope', fingerprint: 'sha256:wrong' },
    })
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      flowsRunner: flowOfAll('a user checks the version then the help'),
      generateRunner: authorBy({ 'a-user-checks-the-version-then-the-help': wrong }),
    })

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    const written = scenarios[0]
    expect(written.id).toBe('a-user-checks-the-version-then-the-help')

    // Plural binds — one per bound section, in milestone order, pinned to the LIVE
    // index (the model's own binding is overwritten, never trusted).
    expect(written.binds).toEqual([...bindsFor(r, DOC, 'help'), ...bindsFor(r, DOC, 'version')])
    // The flow's own goal rides the artifact, so a reader of the file
    // alone knows what it is FOR — `flows.json` may no longer name this flow.
    expect(written.promise).toBe('walk 2 milestone(s)')
    // The flow + interface references the runner reads for drift.
    expect(written.flow).toEqual({
      id: 'a-user-checks-the-version-then-the-help',
      fingerprint: expect.stringMatching(/^sha256:/),
    })
    expect(written.interface!.path).toEqual(['cli/relkit'])
    expect(written.interface!.fingerprints[0]).toMatch(/^sha256:/)
    // Every milestone is attributed to a step.
    expect(written.steps.map((s) => s.milestone)).toEqual([1, 2])
    // Written under the area slug directory.
    expect(fs.existsSync(path.join(scenariosDir(r), 'tools-relkit', `${written.id}.yaml`))).toBe(true)
  })

  it('rejects a scenario that leaves a milestone unrealized, after ONE corrective re-ask', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    let issues: AuthorUserContext['issues']
    let calls = 0
    const forgetful: GenerateRunner = async (ctx) => {
      calls++
      issues = ctx.issues ?? issues
      // Only ever realizes milestone 1 — milestone 2 would go unguarded.
      return { scenario: raw('half a path', [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }]) }
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      flowsRunner: flowOfAll('version then help'),
      generateRunner: forgetful,
    })

    expect(calls).toBe(2) // the call + exactly one corrective re-ask
    expect(issues?.uncoveredMilestones).toEqual([2]) // the engine said exactly what was missing
    expect(res.written).toEqual([])
    expect(res.errors[0].message).toContain('milestone(s) unrealized')
  })

  it('assigns the flow id, and never reuses a hand-written one', async () => {
    const r = seed()

    const handWritten: GuardScenario = {
      id: 'version',
      title: 'hand-written',
      binds: bindsFor(r, DOC, 'version'),
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
      normalize: [],
    }
    writeScenarioFile(r, 'manual/version.yaml', handWritten)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('generated', PASSING_STEPS) }),
    })

    // The flow id is taken, so the collision fallback appends a counter.
    expect(res.written.map((w) => w.id)).toEqual(['version.2'])
    // The hand-written file is untouched.
    expect(fs.existsSync(path.join(scenariosDir(r), 'manual', 'version.yaml'))).toBe(true)
  })
})

describe('generateGuards — birth validation', () => {
  it('persists a scenario that passes at birth', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })
    expect(res.written).toHaveLength(1)
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(res.flows).toMatchObject({ total: 1, settled: 1, unsettled: 0 })
  })

  it('settles an `unservedRoute` birth outcome as a blocked-on gap, not an error', async () => {
    // The safety net for a flow the generate-time route gate could not classify:
    // birth ran it, the bound server 404ed a path ANOTHER app serves, and the runner
    // said so. That is the same fact Gate B blocks on, arriving later — it must
    // settle the flow (hash recorded, no re-authoring forever), never `errors.push`.
    const r = seed()
    const unservedExecutor: GuardExecutor = async ({ scenarios }) =>
      ({
        status: 'ok',
        latestPath: '',
        loadErrors: [],
        manifest: null,
        latest: {
          scenarios: scenarios.map((s) => ({
            id: s.id,
            title: s.title,
            binds: s.binds[0],
            ...(s.flow ? { flowId: s.flow.id } : {}),
            outcome: 'error',
            durationMs: 1,
            unservedRoute: true,
            failure: {
              step: 1,
              expected: 'the bound server "web" (apps/web) to serve GET /v2/bookings',
              actual:
                '404 — /v2/bookings is served by apps/api/v2, which this recipe declares no server for. ' +
                'Declare it under api.servers in .truecourse/scenarios/recipe.json and re-run `guard generate`.',
            },
          })),
        },
      }) as unknown as Awaited<ReturnType<GuardExecutor>>

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      executor: unservedExecutor,
    })

    expect(res.errors).toEqual([])
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on' && g.flowId === 'version')
    expect(gap?.reason).toContain('missing-server')
    expect(gap?.reason).toContain('apps/api/v2')
    // Settled: the flow records its hash, so the next generate is a no-op.
    expect(flowEntry(r, 'version')?.generationInputsHash).toEqual(expect.any(String))
    expect(res.flows).toMatchObject({ unsettled: 0 })
  })

  it('reports a REFUSED run ONCE, in the runner’s own words — never one error per candidate', async () => {
    // The regression: `hit-pay` was declared half-way in recipe.json, the runner
    // refused in 2ms having built and started nothing, and the generator wrote that
    // out as one "birth validation error for <scenario>" per candidate. Two engineers
    // then went looking at a server that had never been asked to start.
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const refusal =
      'external service "hit-pay" is only partly configured: baseUrl is set but no key was resolved.'
    const refusingExecutor: GuardExecutor = async () =>
      ({ status: 'missing-external-env', message: refusal }) as unknown as Awaited<
        ReturnType<GuardExecutor>
      >

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({
        version: raw('relkit --version', PASSING_STEPS),
        help: raw('relkit --help', PASSING_STEPS),
      }),
      executor: refusingExecutor,
    })

    // ONE entry, at the run level, in the runner's grammar — no scenario is named.
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatchObject({ kind: 'refusal', message: refusal })
    expect(res.errors[0].message).not.toContain('birth validation error')
    expect(res.errors[0].flowId).toBeUndefined()

    // And recorded as the run-level fact it is, naming the flows it cancelled.
    expect(res.refusal?.status).toBe('missing-external-env')
    expect(res.refusal?.flowIds.sort()).toEqual(['help', 'version'])

    // Nothing was validated, so nothing was written and no test was judged.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.flows).toMatchObject({ unsettled: 2 })
  })

  it('retries a failing flow ONCE with the evidence, then persists the fix', async () => {
    const r = seed()

    let calls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy(
        { version: { first: raw('broken', FAILING_STEPS), retry: raw('fixed', PASSING_STEPS) } },
        () => calls++,
      ),
    })
    expect(calls).toBe(2) // round 1 + exactly one evidence retry
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios).toHaveLength(1)
  })

  it('COMMITS a still-failing scenario as a failing test and settles the flow', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
    })

    // The test is written like any other, with the status its birth run gave it.
    expect(res.written).toMatchObject([
      { id: 'version', flowId: 'version', surface: 'cli', status: 'failing' },
    ])
    expect(fs.existsSync(path.join(r, res.written[0].file))).toBe(true)
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])

    // Its birth result is recorded exactly as a finding was, now naming the test.
    expect(res.birthFindings).toHaveLength(1)
    const result = res.birthFindings[0]
    expect(result.anchor).toBe('version')
    expect(result.flowId).toBe('version')
    expect(result.surface).toBe('cli')
    expect(result.title).toBe('always broken')
    expect(result.actual).toContain('exit')
    expect(result.evidencePath).toMatch(/guard\/evidence/)
    expect(result.scenarioId).toBe('version')
    expect(result.committed).toBe(true)
    expect(result.file).toBe(res.written[0].file)

    // A committed red test is a decision, not pending work: the flow SETTLED, so the
    // manifest records its inputs hash and the status the test carries — plus the
    // DIAGNOSIS it commits with, the durable record the report's committed
    // finding row re-derives from.
    const committed = flowEntry(r, 'version')!.scenarios
    expect(committed).toMatchObject([{ id: 'version', drivers: ['cli'], status: 'failing' }])
    expect(committed[0].diagnosis).toMatchObject({
      doc: DOC,
      anchor: 'version',
      title: 'always broken',
      step: 1,
      file: res.written[0].file,
    })
    expect(committed[0].diagnosis!.evidencePath).toMatch(/guard\/evidence/)
    expect(flowEntry(r, 'version')?.generationInputsHash).not.toBeNull()
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
  })

  it('re-generating a settled failing test is a no-op — no authoring, no birth run', async () => {
    const r = seed()
    let authorCalls = 0
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }, () => authorCalls++),
      })

    await run()
    expect(authorCalls).toBe(2) // round 1 + the one evidence retry

    const second = await run()
    expect(authorCalls).toBe(2) // unchanged inputs → nothing re-authored
    expect(second.noChanges).toBe(true)
    expect(second.flows.skipped).toBe(1)
    // The committed red test — its status AND its diagnosis — stand.
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(flowEntry(r, 'version')?.scenarios).toMatchObject([
      { id: 'version', drivers: ['cli'], status: 'failing', diagnosis: { title: 'always broken' } },
    ])
  })

  it('a failing flow NEVER withholds a healthy sibling — persist is independent', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({
        version: raw('good', PASSING_STEPS),
        help: raw('bad', FAILING_STEPS),
      }),
    })

    // Each flow commits its own test with its own status; neither waits on the other.
    expect(res.written.map((w) => [w.flowId, w.status]).sort()).toEqual([
      ['help', 'failing'],
      ['version', 'passing'],
    ])
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['help', 'version'])
    expect(res.birthFindings.map((f) => f.flowId)).toEqual(['help'])
    expect(res.flows).toMatchObject({ settled: 2, unsettled: 0 })
    expect(flowEntry(r, 'version')?.generationInputsHash).not.toBeNull()
    expect(flowEntry(r, 'help')?.generationInputsHash).not.toBeNull()
  })

  it('attributes a finding to the FAILING milestone and marks a broken chain for triage', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    // A composite flow whose SECOND milestone fails: milestone 1 ran green first, so
    // the chain broke mid-path — the "milestones don't chain" triage category.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}), // one claim per section, named `<anchor> claim`
      flowsRunner: flowOfAll('the two-step path'),
      generateRunner: authorBy({
        'the-two-step-path': raw('chain', [
          { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
          { run: ['boom'], expect: { exit: 0 }, milestone: 2 },
        ]),
      }),
    })

    const finding = res.birthFindings[0]
    expect(finding.failedMilestone).toBe(2)
    expect(finding.priorMilestonesPassed).toBe(true)
    expect(isCompositionFinding(finding)).toBe(true)
    // It pivots on the milestone that broke — its section and its claim, so the
    // detail points at the sentence that disagrees rather than the flow's head.
    // Sections are indexed in anchor order, so `version` is the second milestone.
    expect(finding.anchor).toBe('version')
    expect(finding.claim).toBe('version claim')
  })

  it('a first-milestone failure is NOT a composition finding', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('broken', FAILING_STEPS) }),
    })

    const finding = res.birthFindings[0]
    expect(finding.failedMilestone).toBe(1)
    expect(finding.priorMilestonesPassed).toBe(false)
    expect(isCompositionFinding(finding)).toBe(false)
  })
})

describe('generateGuards — failure output excerpts (Fix 1)', () => {
  it('a birth finding carries the failing run raw stderr; the empty stdout is omitted', async () => {
    const r = seed()

    // FAILING_STEPS runs `boom` → exit 7, stderr "fatal: intentional failure".
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
    })
    const finding = res.birthFindings[0]
    expect(finding.stderr).toContain('fatal: intentional failure')
    expect(finding.stdout).toBeUndefined()
  })

  it('threads the failing run output into the retry evidence the model sees', async () => {
    const r = seed()

    let retryStderr: string | undefined
    let retryStdout: unknown = 'SENTINEL'
    const runner: GenerateRunner = async (ctx) => {
      if (ctx.retry) {
        retryStderr = ctx.retry.stderr
        retryStdout = ctx.retry.stdout
        return { scenario: stampMilestones(raw('fixed', PASSING_STEPS), ctx.milestones.length) }
      }
      return { scenario: stampMilestones(raw('broken', FAILING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(retryStderr).toContain('fatal: intentional failure')
    // boom writes nothing to stdout → the retry evidence omits it.
    expect(retryStdout).toBeUndefined()
  })
})

describe('retryCacheKey — evidence sensitivity (Fix 1)', () => {
  const flow = { fingerprint: 'sha256:flow' }
  const sectionKeys = ['sha256:s']
  const interfaces = ['sha256:j']
  const base: GuardBirthFinding = { doc: DOC, anchor: 'add', title: 't', step: 1, expected: 'exit 3', actual: 'exit 2' }
  const keyFor = (evidence: GuardBirthFinding) =>
    retryCacheKey(flow, 'cli', sectionKeys, interfaces, 'fp', evidence)

  it('moves when the evidence excerpts differ', () => {
    expect(keyFor({ ...base, stderr: 'usage A' })).not.toBe(keyFor({ ...base, stderr: 'usage B' }))
  })

  it('is stable for identical evidence', () => {
    expect(keyFor({ ...base, stderr: 'usage A' })).toBe(keyFor({ ...base, stderr: 'usage A' }))
  })

  it('an entry with no excerpts never collides with one carrying excerpts', () => {
    expect(keyFor(base)).not.toBe(keyFor({ ...base, stderr: 'usage' }))
  })

  it('moves with the failing MILESTONE — the same message on another step is another re-ask', () => {
    expect(keyFor({ ...base, failedMilestone: 1 })).not.toBe(keyFor({ ...base, failedMilestone: 2 }))
  })
})

describe('generateGuards — dismissals (decisions.json)', () => {
  // Two cli claims in ONE section, composed into one flow: dismissing one changes
  // the flow's composition, which is the whole point of the milestone identity.
  const twoClaims = extractBy({
    version: [{ claim: 'CLAIM_BAD' }, { claim: 'CLAIM_GOOD' }],
    background: { untestable: 'bg' },
  })

  it('findings carry their authored YAML and the extracted claim text', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: twoClaims,
      flowsRunner: flowOfAll('the bad path'),
      generateRunner: authorBy({ 'the-bad-path': raw('bad', FAILING_STEPS) }),
    })

    const finding = res.birthFindings.find((f) => f.title === 'bad')!
    expect(finding.claim).toBe('CLAIM_BAD')
    expect(finding.yaml).toContain('title: bad')
    expect(finding.yaml).toContain('section: version')
  })

  it('dismissing a claim drops its milestone, records a gap, and re-synthesizes the flow', async () => {
    const r = seed()
    const runOnce = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: twoClaims,
        flowsRunner: flowOfAll('the whole path'),
        generateRunner: authorBy({ 'the-whole-path': raw('walks it', PASSING_STEPS) }),
      })

    const first = await runOnce()
    expect(first.written).toHaveLength(1)
    const before = readManifest(r)!.flows[0]

    dismissGuardClaim(r, { doc: DOC, anchor: 'version', title: 'CLAIM_BAD', dismissedAt: '2026-07-08T00:00:00.000Z' })

    const second = await runOnce()
    const dismissedGap = second.coverageGaps.find((g) => g.kind === 'dismissed')!
    expect(dismissedGap).toMatchObject({ doc: DOC, anchor: 'version' })
    expect(dismissedGap.reason).toContain('CLAIM_BAD')
    expect(second.orphanedDismissals).toEqual([]) // the dismissal matched a live claim
    // Dismissing a claim removes a MILESTONE, which moves the flow's composition —
    // so the flow re-authors instead of skipping. Dismissal has a price tag now.
    expect(second.flows.skipped).toBe(0)
    expect(second.written).toHaveLength(1)
    const after = readManifest(r)!.flows[0]
    expect(after.flowFingerprint).not.toBe(before.flowFingerprint)
  })

  it('dismissing the claim a FAILING test asserts removes the test file next generate', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      })

    // The disagreement is committed as a red test — the user's decision surface.
    const first = await run()
    expect(first.written).toMatchObject([{ id: 'version', status: 'failing' }])
    const file = path.join(r, first.written[0].file)
    expect(fs.existsSync(file)).toBe(true)

    // "This claim is noise" — the dismissal keys on the extracted claim, unchanged.
    dismissGuardClaim(r, {
      doc: DOC,
      anchor: 'version',
      title: 'version claim',
      dismissedAt: '2026-07-26T00:00:00.000Z',
    })

    const second = await run()
    // The claim is gone, so the flow it was the whole of is gone — and its test goes
    // with it rather than lingering red or as orphaned drift.
    expect(fs.existsSync(file)).toBe(false)
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(flowEntry(r, 'version')).toBeUndefined()
    expect(second.birthFindings).toEqual([])
    expect(second.orphanedDismissals).toEqual([])
    expect(second.coverageGaps.find((g) => g.kind === 'dismissed')?.reason).toContain('version claim')
  })

  it('a dismissal whose claim text no longer matches any live claim surfaces as orphaned', async () => {
    const r = seed()

    dismissGuardClaim(r, { doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT', dismissedAt: '2026-07-08T00:00:00.000Z' })

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(res.orphanedDismissals).toEqual([{ doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT' }])
    // The live claim is unaffected — it authors + commits normally.
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  })

  it('a dismissed FLOW is dropped with its scenarios and settles as a dismissed gap', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      })

    await run()
    expect(loadScenarios(r).scenarios).toHaveLength(1)

    // The user judged the whole flow not worth guarding.
    const decisions = path.join(r, '.truecourse', 'scenarios', 'decisions.json')
    fs.writeFileSync(
      decisions,
      JSON.stringify({
        version: 1,
        dismissedClaims: [],
        dismissedFlows: [{ flowId: 'version', title: 'version', dismissedAt: '2026-07-08T00:00:00.000Z', note: 'not a user path' }],
      }),
    )

    const res = await run()
    expect(res.flows.dismissed).toBe(1)
    expect(res.flows.total).toBe(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'dismissed' && g.flowId === 'version')!
    expect(gap.reason).toContain('not a user path')
    // Its scenarios go with it — an explicit "don't guard this".
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(flowEntry(r, 'version')).toBeUndefined()
  })

  it('a flow dismissal that matches no live flow is surfaced as orphaned', async () => {
    const r = seed()
    fs.mkdirSync(path.join(r, '.truecourse', 'scenarios'), { recursive: true })
    fs.writeFileSync(
      path.join(r, '.truecourse', 'scenarios', 'decisions.json'),
      JSON.stringify({
        version: 1,
        dismissedClaims: [],
        dismissedFlows: [{ flowId: 'a-flow-that-was-recomposed', title: 'gone', dismissedAt: '2026-07-08T00:00:00.000Z' }],
      }),
    )

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable })

    expect(res.orphanedFlowDismissals).toEqual([{ flowId: 'a-flow-that-was-recomposed', title: 'gone' }])
    expect(res.written).toHaveLength(1) // the live flow is unaffected
  })
})

describe('generateGuards — capability/materialization-error retry routing', () => {
  // A scenario declaring a git commit of a file it never seeded via `setup.files`
  // fails materialization with a precise provider message — a generation defect,
  // routed through the same one evidence-retry as a birth `fail`.
  const UNSEEDED_GIT = { git: { commits: [{ files: ['README.md'] }] } }

  it('retries a materialization error ONCE with the capability message as evidence, then persists the fix', async () => {
    const r = seed()

    let calls = 0
    let retryEvidence: { expected?: string; actual?: string } | undefined
    const runner: GenerateRunner = async (ctx) => {
      calls++
      if (ctx.retry) {
        retryEvidence = { expected: ctx.retry.expected, actual: ctx.retry.actual }
        return { scenario: stampMilestones(raw('fixed', PASSING_STEPS), ctx.milestones.length) }
      }
      // Round 1: a git commit of an unseeded file → materialization fails.
      return {
        scenario: stampMilestones(raw('broken', PASSING_STEPS, { setup: UNSEEDED_GIT }), ctx.milestones.length),
      }
    }

    const retries: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: runner,
      onRetryProgress: (done, total) => retries.push([done, total]),
    })

    expect(calls).toBe(2) // round 1 + exactly one retry
    // The retry carried the git provider's precise message as its evidence.
    expect(retryEvidence?.actual).toContain('declared file does not exist in the sandbox: README.md')
    expect(retryEvidence?.actual).toContain('seed it via setup.files')
    // The capability error ticked the retry round exactly like a birth fail.
    expect(retries).toEqual([
      [0, 1],
      [1, 1],
    ])
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(1)
  })

  it('records an error and leaves the flow unsettled when the materialization error persists (one retry, never two)', async () => {
    const r = seed()

    let calls = 0
    const runner: GenerateRunner = async (ctx) => {
      calls++
      return {
        scenario: stampMilestones(
          raw(ctx.retry ? 'still-broken' : 'broken', PASSING_STEPS, { setup: UNSEEDED_GIT }),
          ctx.milestones.length,
        ),
      }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(calls).toBe(2) // round 1 + exactly one retry, no second
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    const err = res.errors.find((e) => e.anchor === 'version')!
    expect(err.message).toContain('declared file does not exist in the sandbox: README.md')
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(flowEntry(r, 'version')?.generationInputsHash).toBeNull()
  })

  it('caches the materialization-error retry: a rerun reaches the same outcome without re-authoring', async () => {
    const r = seed()

    let round1Calls = 0
    let retryCalls = 0
    const runner: GenerateRunner = async (ctx) => {
      if (ctx.retry) retryCalls++
      else round1Calls++
      return {
        scenario: stampMilestones(
          ctx.retry ? raw('fixed', PASSING_STEPS) : raw('broken', PASSING_STEPS, { setup: UNSEEDED_GIT }),
          ctx.milestones.length,
        ),
      }
    }

    const res1 = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(res1.written.map((w) => w.title)).toEqual(['fixed'])
    expect([round1Calls, retryCalls]).toEqual([1, 1])

    // Reset the manifest so the flow is work again; BOTH the round-1 authoring and
    // the capability-error retry are cache hits — the runner is not called.
    writeManifest(r, { flows: [] })
    round1Calls = 0
    retryCalls = 0
    const res2 = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect([round1Calls, retryCalls]).toEqual([0, 0])
    expect(res2.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res2.birthPassed).toBe(1)
  })
})

describe('generateGuards — malformed extraction (re-ask + fail-soft)', () => {
  it('re-asks ONCE on invalid extraction output and accepts the correction', async () => {
    const r = seed()

    let calls = 0
    const runner: ExtractRunner = async ({ outline, correction }) => {
      calls++
      if (!correction) return { not: 'an extraction' } // first call malformed
      return {
        claims: outline
          .filter((e) => e.anchor === 'version')
          .map((e) => ({ claim: 'v', driver: 'cli', sectionAnchor: e.anchor, reason: 'exit' })),
        untestable: [{ sectionAnchor: 'background', reason: 'bg' }],
      }
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: runner,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(calls).toBe(2) // one call + one corrective re-ask
    expect(res.extractionFailures).toEqual([])
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  })

  it('records a per-document extraction failure when invalid even after the re-ask; other docs continue', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: TWO_CLI_DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const runner: ExtractRunner = async ({ doc, outline }) => {
      if (doc === DOC) return { still: 'wrong' } // invalid on both call and re-ask
      return {
        claims: outline.map((e) => ({ claim: 'c', driver: 'cli', sectionAnchor: e.anchor, reason: 'exit' })),
        untestable: [],
      }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: runner })

    expect(res.status).toBe('ok') // fail-soft: never throws
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    // The other doc's claims still compose into flows and settle.
    expect(res.written.map((w) => w.flowId).sort()).toEqual(['help', 'version'])
    // The failed doc contributed no claim, so no flow binds it — nothing to settle.
    expect(manifestSections(r).some((s) => s.doc === DOC)).toBe(false)
  })

  it('a thrown extraction call is a fail-soft failure (not a crash)', async () => {
    const r = seed()

    const throwing: ExtractRunner = async () => {
      throw new Error('transport timeout')
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: throwing })

    expect(res.status).toBe('ok')
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.extractionFailures[0].reason).toMatch(/call failed/)
    expect(res.written).toEqual([])
  })
})

describe('generateGuards — authoring robustness', () => {
  it('one flow’s authoring failure never costs its siblings their scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const gen: GenerateRunner = async (ctx) => {
      if (ctx.flow.id === 'version') throw new Error('transport exploded')
      return { scenario: stampMilestones(raw('help works', PASSING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: extractBy({}), generateRunner: gen })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['help'])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    expect(flowEntry(r, 'version')?.generationInputsHash).toBeNull()
    expect(flowEntry(r, 'help')?.scenarios).toEqual([{ id: 'help', drivers: ['cli'], status: 'passing' }])
  })

  // A `matches` the schema accepts but `new RegExp` rejects would throw or never
  // match at BIRTH, after a sandbox execution has already been paid for.
  it('re-asks on an authored `matches` that does not compile, and persists the correction', async () => {
    const r = seed()
    const contexts: AuthorUserContext[] = []
    let calls = 0
    const gen: GenerateRunner = async (ctx) => {
      contexts.push(ctx)
      calls++
      const steps =
        calls === 1
          ? [{ run: ['--version'], expect: { stdout: { matches: '1\\.[0-9' } } }]
          : [{ run: ['--version'], expect: { exit: 0 } }]
      return { scenario: stampMilestones(raw('version prints', steps as never), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(calls).toBe(2)
    // The re-ask names the offending step, where it sits, and the compile error.
    expect(contexts[1].issues?.invalidPattern).toMatchObject({ step: 1, where: 'expect.stdout' })
    expect(res.errors).toEqual([])
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  })

  it('records an error when the authored `matches` is still uncompilable after the re-ask', async () => {
    const r = seed()
    const gen: GenerateRunner = async (ctx) => ({
      scenario: stampMilestones(
        raw('version prints', [{ run: ['--version'], expect: { stdout: { matches: '1\\.[0-9' } } }] as never),
        ctx.milestones.length,
      ),
    })

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(res.written).toEqual([])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    expect(res.errors[0].message).toContain('invalid `matches` regex after re-ask')
  })

  it('re-asks ONCE on a malformed authoring output, then records an error', async () => {
    const r = seed()

    let calls = 0
    const gen: GenerateRunner = async () => {
      calls++
      return { scenario: { nope: true } } // invalid on both the call and the re-ask
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(calls).toBe(2) // authoring call + one corrective re-ask
    // The only authoring call of the run came back unusable — an abort, not a
    // clean settle (see llm-failure-accounting).
    expect(res.status).toBe('llm-failed')
    expect(res.written).toEqual([])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
  })
})

describe('generateGuards — manifest + orphans', () => {
  it('carries an orphaned flow WITH tests forward untouched, and marks it', async () => {
    const r = seed()

    // A prior flow whose sections no longer exist on disk.
    writeManifest(r, {
      flows: [
        {
          flowId: 'a-removed-flow',
          flowFingerprint: 'sha256:old',
          bindings: [{ doc: 'docs/gone.md', anchor: 'removed/section', fingerprint: 'sha256:old' }],
          scenarios: [{ id: 'orphan', drivers: ['cli'], status: 'passing' }],
          generationInputsHash: 'sha256:x',
          gaps: [],
        },
      ],
    })

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    // Reported, never deleted: the next `guard run` surfaces those scenarios as
    // orphaned drift instead of coverage silently disappearing.
    expect(res.orphaned).toEqual([{ doc: 'docs/gone.md', anchor: 'removed/section', scenarioIds: ['orphan'] }])
    expect(() => GuardManifestSchema.parse(readManifest(r)!)).not.toThrow()
    expect(flowEntry(r, 'a-removed-flow')?.scenarios).toEqual([
      { id: 'orphan', drivers: ['cli'], status: 'passing' },
    ])
    // MARKED: nothing derives it any more, so every reader can say why it has no
    // goal and no milestones instead of rendering a hollow flow.
    expect(flowEntry(r, 'a-removed-flow')?.orphaned).toBe(true)
    // A flow synthesis still produces is never marked.
    expect(flowEntry(r, 'version')?.orphaned).toBeUndefined()
    expect(flowEntry(r, 'version')?.scenarios).toEqual([
      { id: 'version', drivers: ['cli'], status: 'passing' },
    ])
  })

  it('PRUNES an orphaned flow with no test — its stale gaps die with it', async () => {
    const r = seed()
    const runners = {
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    }
    // A first, ordinary generate — `version` settles and flows.json is written.
    await runGenerate({ repoRoot: r, ...runners })
    const settled = flowEntry(r, 'version')!

    // Now seed the two shapes a ghost arrives in: one carried by an OLD generate
    // (before the mark existed) and one already marked by a new one. Both bind a
    // section that is gone, carry a gap explaining a test that will never be
    // written, and realize nothing at all.
    const ghost = (flowId: string, extra: object) => ({
      flowId,
      flowFingerprint: 'sha256:old',
      bindings: [{ doc: 'docs/gone.md', anchor: `${flowId}/section`, fingerprint: 'sha256:old' }],
      scenarios: [],
      generationInputsHash: 'sha256:x',
      gaps: [{ surface: 'cli' as const, kind: 'no-interface' as const, reason: 'no cli interface does this' }],
      ...extra,
    })
    writeManifest(r, {
      flows: [settled, ghost('carried-before-the-mark', {}), ghost('carried-after-the-mark', { orphaned: true })],
    })

    // Nothing about the specs moved: this run's ONLY work is the prune.
    const res = await runGenerate({ repoRoot: r, ...runners })

    expect(readManifest(r)!.flows.map((f) => f.flowId)).toEqual(['version'])
    // The gaps went with the entries — a gap explaining a missing test for a flow
    // that no longer exists is the bare row the dogfood store surfaced.
    expect(readManifest(r)!.flows.flatMap((f) => f.gaps)).toEqual([])
    expect(manifestSections(r).map((s) => s.doc)).not.toContain('docs/gone.md')
    // A prune rewrites a committed file, so the run is not a no-op…
    expect(res.noChanges).toBe(false)
    // …and the orphan count, which means "orphans whose coverage was kept", never
    // counts a pruned ghost (nor goes negative on one carried by an earlier run).
    expect(res.flows.orphaned).toBe(0)
    expect(flowEntry(r, 'version')).toEqual(settled)
  })


  it('the report round-trips through the schema, flow counts included', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })
    expect(() => GuardGenerateReportSchema.parse({ ...res, generatedAt: '2026-07-25T00:00:00.000Z' })).not.toThrow()
  })

  it('an old-shape report with no flow counts still parses (optional fields)', () => {
    const rep = {
      generatedAt: '2026-01-02T03:04:05.000Z',
      status: 'ok' as const,
      sectionsTotal: 0,
      sectionsChanged: 0,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })
})

describe('generateGuards — universe + recipe discovery', () => {
  it('errors with a spec-scan hint when there is no corpus', async () => {
    const r = repo()
    const res = await generateGuards({ repoRoot: r })
    expect(res.status).toBe('no-docs')
    expect(res.reason).toMatch(/spec scan/)
  })

  it('the corpus is the only doc authority — committed scenarios do not create a universe', async () => {
    const r = repo()
    writeDoc(r, DOC, DOC_CONTENT)
    writeScenarioFile(r, 'manual/version.yaml', {
      id: 'version',
      title: 'hand-written',
      binds: bindsFor(r, DOC, 'version'),
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
      normalize: [],
    })
    const res = await generateGuards({ repoRoot: r })
    expect(res.status).toBe('no-docs')
    expect(res.reason).toMatch(/spec scan/)
  })

  // The hard no-derivation gate, on the WORKING-TREE path: derivation lives in
  // `truecourse guard setup` now, and generate refuses rather than paying to
  // rediscover something whose fix would re-author everything it just authored.
  it('refuses to derive a recipe when the caller requires an existing one', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      requireExistingRecipe: true,
      recipeRunner: async () => {
        throw new Error('the recipe proposer must not be called')
      },
    })

    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toMatch(/truecourse guard setup/)
  })

  // …and the hosted/EE path (an ephemeral checkout nobody has a terminal in) keeps
  // deriving exactly as it always has.
  it('discovers, verifies, and writes a recipe when none exists', async () => {
    const r = repo()
    // No recipe.json — discovery must propose one and the engine verifies it.
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      recipeRunner: async () => ({ build: 'true', entry: ['node', (await import('./helpers.js')).FIXTURE_BIN] }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    expect(fs.existsSync(path.join(scenariosDir(r), 'recipe.json'))).toBe(true)
    expect(res.written).toHaveLength(1)
  })

  it('verifies a proposal with an install step (install runs before the build) and writes it', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      recipeRunner: async () => ({
        install: 'touch install-marker',
        // The verification build only succeeds when the install already ran.
        build: 'test -f install-marker',
        entry: ['node', (await import('./helpers.js')).FIXTURE_BIN],
      }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    const written = JSON.parse(fs.readFileSync(path.join(scenariosDir(r), 'recipe.json'), 'utf-8'))
    expect(written.install).toBe('touch install-marker')
    expect(written.build).toBe('test -f install-marker')
  })

  it('a failing proposal install is verify-failed against the install command; no recipe is written', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      recipeRunner: async () => ({
        install: 'false',
        build: 'true',
        entry: ['node', (await import('./helpers.js')).FIXTURE_BIN],
      }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(res.status).toBe('recipe-failed')
    if (res.status === 'recipe-failed') expect(res.reason).toMatch(/^install `false` failed/)
    expect(fs.existsSync(path.join(scenariosDir(r), 'recipe.json'))).toBe(false)
  })
})

// A birth candidate whose scenario binds to the live `version` section and runs
// `steps`; the flow/surface fields are carried back through the runner.
function candidate(repoRoot: string, id: string, steps: GuardScenario['steps']): BirthCandidate {
  const binds = bindsFor(repoRoot, DOC, 'version')
  const flow: GuardFlow = {
    id: 'version',
    title: 'version',
    goal: 'the version prints',
    fingerprint: 'sha256:flow',
    milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: 'c' }],
    bindings: [{ doc: DOC, anchor: 'version', fingerprint: binds[0].fingerprint }],
    composedOf: [],
    synthesisInputsHash: 'sha256:inputs',
  }
  const scenario: GuardScenario = {
    id,
    title: id,
    flow: { id: flow.id, fingerprint: flow.fingerprint },
    interface: { path: ['cli/relkit'], fingerprints: ['sha256:j'] },
    binds,
    driver: 'cli',
    steps,
    normalize: [],
  }
  return {
    flow,
    surface: 'cli',
    section: {
      doc: DOC,
      anchor: 'version',
      fingerprint: binds[0].fingerprint,
      headingText: 'version',
      level: 2,
      ownText: '',
      fullText: '',
      areaTags: [],
      suppressionFingerprint: '',
      endpointSchemaFingerprint: '',
      securityFingerprint: '',
    },
    scenario,
    ref: id,
  }
}

describe('birthValidate — progress forwarding', () => {
  it('forwards per-scenario settle callbacks and the build/run phases to the runner', async () => {
    const r = seed()

    const candidates = [
      candidate(r, 'version', PASSING_STEPS),
      candidate(r, 'version.cli.2', PASSING_STEPS),
      candidate(r, 'version.cli.3', PASSING_STEPS),
    ]
    const phases: string[] = []
    const settled: number[] = []
    const { outcomes } = await birthValidate(r, candidates, {
      executor: defaultGuardExecutor,
      recipe: loadRecipe(r, recipePath(r))!.recipe,
      skipBuild: false,
      onPhase: (phase) => phases.push(phase),
      onScenarioSettled: (done, total) => {
        expect(total).toBe(3)
        settled.push(done)
      },
    })

    expect(outcomes).toHaveLength(3)
    expect(outcomes.every((o) => o.result.outcome === 'pass')).toBe(true)
    expect(phases).toEqual(['build', 'run']) // build once, then run
    expect(settled).toEqual([1, 2, 3]) // one callback per scenario, monotonic
  })
})

describe('generateGuards — live progress', () => {
  it('reports the interface catalog, then ticks synthesis and matching', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    let mapped: [number, number] | undefined
    const flows: Array<[number, number]> = []
    const matches: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      onInterfaces: (interfaces, surfaces) => (mapped = [interfaces, surfaces]),
      onFlowProgress: (done, total) => flows.push([done, total]),
      onMatchProgress: (done, total) => matches.push([done, total]),
    })

    expect(res.written).toHaveLength(2)
    expect(mapped).toEqual([2, 1]) // two cli interfaces, one surface
    expect(flows).toEqual([[0, 1], [1, 1]]) // one area, announced then settled
    // Two flows × one matchable surface — the denominator is known up front.
    expect(matches).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('fires onBirthProgress once per scenario, with the build/run phases', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const births: Array<[number, number]> = []
    const phases: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      onBirthPhase: (phase) => phases.push(phase),
      onBirthProgress: (done, total) => births.push([done, total]),
    })

    expect(res.written).toHaveLength(2)
    expect(res.birthPassed).toBe(2)
    // Two scenarios → two birth ticks (not one atomic round update), total = 2.
    expect(births).toEqual([[1, 2], [2, 2]])
    expect(phases).toContain('build')
    expect(phases).toContain('run')
  })

  it('fires onExtractViewProgress with the planned total upfront, then once per view', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '# Alpha\n\nRunning with --version prints the version.\n')
    writeDoc(r, 'docs/b.md', '# Beta\n\nRunning with --version prints the version.\n')

    const views: Array<[number, number]> = []
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      onExtractViewProgress: (done, total) => views.push([done, total]),
    })

    // Two small docs → one view each. The planned denominator is announced up
    // front (0/2 before any call), then the counter ticks per VIEW with the
    // cross-doc total (the live unit — docs alone can sit at 0 for minutes).
    expect(views).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('fires onRetryProgress with the pooled failed-flow total', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    // Both flows fail birth in round 1; each retry (evidence attached) fixes it.
    const runner: GenerateRunner = async (ctx) => ({
      scenario: stampMilestones(
        ctx.retry ? raw('fixed', PASSING_STEPS) : raw('broken', FAILING_STEPS),
        ctx.milestones.length,
      ),
    })

    const retries: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: runner,
      onRetryProgress: (done, total) => retries.push([done, total]),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed', 'fixed'])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(2) // both retries passed in round 2
    // Batched birth pools BOTH flows' failures into one retry round, so the total is
    // known up front — announced once, then ticked as each re-authoring completes.
    expect(retries).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('fires onFlowSettled per flow, and an unsettled flow still ticks (its gaps are recorded)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const ticks: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: raw('good', PASSING_STEPS), help: raw('bad', FAILING_STEPS) }),
      onFlowSettled: (settled, total) => ticks.push([settled, total]),
    })

    expect(res.written.map((w) => w.status).sort()).toEqual(['failing', 'passing'])
    // The denominator is announced before the first slow phase, then each flow ticks
    // as it settles — including the one whose test was committed red, since a red
    // test IS a settled record.
    expect(ticks).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })
})

describe('generateGuards — grounded authoring', () => {
  it('captures real behavior and passes the transcripts to the authoring runner', async () => {
    const r = seed()

    let received: ProbeTranscript[] | undefined
    const extract = extractBy({
      version: [{ claim: '`--version` prints the version and exits 0' }],
      background: { untestable: 'bg' },
    })
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return { scenario: stampMilestones(raw('v', PASSING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: gen })

    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(received).toBeDefined()
    // The claim named `--version`; relkit prints 2.4.1 at exit 0 in the empty sandbox.
    const probe = received!.find((p) => p.argv.join(' ') === '--version')
    expect(probe).toBeDefined()
    expect(probe!.exit).toBe(0)
    expect(probe!.stdout).toContain('2.4.1')
  })

  it('authors ungrounded (empty probes) when the recipe build fails', async () => {
    const r = repo()
    writeRecipe(r, { build: 'false' }) // build fails → no probing
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let received: ProbeTranscript[] | undefined
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return { scenario: stampMilestones(raw('v', PASSING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    // The authoring call still happened, but with no transcripts; birth then errors
    // on the broken build so nothing settles.
    expect(received).toEqual([])
    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  })

  it('runs the recipe install before the birth build (the build sees the install marker)', async () => {
    const r = repo()
    // The birth build only succeeds when the install already ran → order proven.
    writeRecipe(r, { install: 'touch marker', build: 'test -f marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.errors).toEqual([])
  })

  it('authors ungrounded and errors on birth when the recipe install fails (exactly like a failing build)', async () => {
    const r = repo()
    writeRecipe(r, { install: 'false', build: 'true' }) // install fails → no probing, birth errors
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let received: ProbeTranscript[] | undefined
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return { scenario: stampMilestones(raw('v', PASSING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(received).toEqual([])
    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  })

  it('fires onGroundProgress as probes are planned then captured', async () => {
    const r = seed()

    const ground: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'bg' },
      }),
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
      onGroundProgress: (captured, planned) => ground.push([captured, planned]),
    })

    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // Phase 1 is the `--help` surface alone (0/1, 1/1); the exact `--version`
    // fragment runs in phase 2 (1/2, 2/2). No expansion probes (the fixture's
    // help surface names no subcommand the claim also mentions).
    expect(ground).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
    ])
  })

  it('does not fire onGroundProgress when authoring is fully cached (no probes run)', async () => {
    const r = seed()

    const runners = {
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    }
    await runGenerate({ repoRoot: r, ...runners })

    // Reset the manifest so the flow is work again; authoring is a cache HIT → no
    // authoring call and therefore no grounding.
    writeManifest(r, { flows: [] })
    let groundCalls = 0
    await runGenerate({ repoRoot: r, ...runners, onGroundProgress: () => groundCalls++ })
    expect(groundCalls).toBe(0)
  })
})

describe('generateGuards — the per-flow pipeline', () => {
  it('settles every flow after ONE batched birth, each with a stable manifest entry', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')

    const res = await runGenerate({
      repoRoot: r,
      concurrency: 4, // both flows author concurrently
      extractRunner: extractBy({}), // one cli claim per doc → two independent flows
    })

    expect(res.written.map((w) => w.flowId).sort()).toEqual(['alpha', 'beta'])
    expect(flowEntry(r, 'alpha')?.scenarios).toEqual([{ id: 'alpha', drivers: ['cli'], status: 'passing' }])
    expect(flowEntry(r, 'beta')?.scenarios).toEqual([{ id: 'beta', drivers: ['cli'], status: 'passing' }])
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha', 'beta'])
    expect(fs.existsSync(path.join(scenariosDir(r), 'a', 'alpha.yaml'))).toBe(true)
  })

  it('kicks the recipe build at run start, parallel with authoring', async () => {
    const r = repo()
    // The build writes a marker in the repo root; the author runner waits for it.
    writeRecipe(r, { build: 'touch build-marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let sawMarker = false
    const gen: GenerateRunner = async (ctx) => {
      // The build was kicked as soon as there was authoring work (not after it), so
      // its marker shows up WHILE authoring runs — a barrier build never would.
      const start = Date.now()
      while (!fs.existsSync(path.join(r, 'build-marker'))) {
        if (Date.now() - start > 4000) throw new Error('the build never ran alongside authoring')
        await new Promise((res) => setTimeout(res, 10))
      }
      sawMarker = true
      return { scenario: stampMilestones(raw('v', PASSING_STEPS), ctx.milestones.length) }
    }

    const res = await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })
    expect(sawMarker).toBe(true)
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  })

  it('a flow reuses its own prior id and never steals a sibling’s', async () => {
    const r = repo()
    writeRecipe(r)
    // Two docs whose sections share the heading leaf "limits" → the flow ids are
    // disambiguated by synthesis, and each keeps its own scenario id across re-runs.
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## limits\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## limits\n`relkit --version` exits 0.\n')

    const first = await runGenerate({ repoRoot: r, concurrency: 4, extractRunner: extractBy({}) })
    const ids = first.written.map((w) => w.id).sort()
    expect(ids).toEqual(['limits', 'limits-2'])

    // Re-run against a STALE manifest: both flows re-author and must land on the
    // SAME ids (each frees its own before assigning), never colliding.
    writeManifest(r, {
      flows: readManifest(r)!.flows.map((f) => ({ ...f, generationInputsHash: 'sha256:stale' })),
    })
    const second = await runGenerate({ repoRoot: r, concurrency: 4, extractRunner: extractBy({}) })
    expect(second.written.map((w) => w.id).sort()).toEqual(ids)
    expect(new Set(loadScenarios(r).scenarios.map((s) => s.id)).size).toBe(2)
  })

  it('stops after synthesis when the internal seam asks it to', async () => {
    const r = seed()
    let matchCalls = 0

    const res = await runGenerate({
      repoRoot: r,
      stopAfterFlows: true,
      extractRunner: versionCliBgUntestable,
      matchRunner: matchAll(() => matchCalls++),
    })

    expect(matchCalls).toBe(0)
    expect(res.written).toEqual([])
    expect(res.flows.total).toBe(1)
    // The flow corpus IS written — that is the artifact the seam exists to produce.
    expect(fs.existsSync(path.join(scenariosDir(r), 'flows.json'))).toBe(true)
  })
})

describe('spawnGenerateRunner — retry stage attribution', () => {
  const ctxFor = (retry?: AuthorUserContext['retry']): AuthorUserContext => ({
    flow: { id: 'version', title: 'version', goal: 'the version prints' },
    milestones: [
      {
        order: 1,
        claim: 'v',
        doc: DOC,
        sectionHeading: 'version',
        sectionText: '`relkit --version` prints the version.',
        realization: ['run: ["--version"]   (interface cli/relkit)'],
      },
    ],
    interfacePath: ['cli/relkit'],
    areaTags: [],
    driver: 'cli',
    recipeEntry: ['node', 'bin.mjs'],
    recipeBuild: 'true',
    ...(retry ? { retry } : {}),
  })
  const retry = { scenarioTitle: 't', step: 1, expected: 'e', actual: 'a' }

  it('logs round-1 under guard.generate and a retry under guard.retry with the retry model', async () => {
    const seen: Array<{ stage: string; model?: string }> = []
    const transport: LlmTransport = async (req) => {
      seen.push({ stage: req.stage, model: req.model })
      return '{}'
    }
    const runner = spawnGenerateRunner({ transport, model: 'opus', retryModel: 'sonnet' })
    await runner(ctxFor())
    await runner(ctxFor(retry))
    expect(seen).toEqual([
      { stage: 'guard.generate', model: 'opus' },
      { stage: 'guard.retry', model: 'sonnet' },
    ])
  })

  it('a retry defaults to the generate model when no retry model is configured', async () => {
    const seen: Array<{ stage: string; model?: string }> = []
    const transport: LlmTransport = async (req) => {
      seen.push({ stage: req.stage, model: req.model })
      return '{}'
    }
    const runner = spawnGenerateRunner({ transport, model: 'opus' })
    await runner(ctxFor(retry))
    expect(seen).toEqual([{ stage: 'guard.retry', model: 'opus' }])
  })
})

describe('generateGuards — the committed flow corpus', () => {
  it('writes flows.json and references its flows by id from the scenarios', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }),
    })

    const flows = JSON.parse(fs.readFileSync(path.join(scenariosDir(r), 'flows.json'), 'utf-8'))
    expect(flows.flows.map((f: { id: string }) => f.id)).toEqual(['version'])
    const scenario = yaml.load(
      fs.readFileSync(path.join(scenariosDir(r), 'cli', 'version.yaml'), 'utf-8'),
    ) as GuardScenario
    expect(scenario.flow!.id).toBe('version')
    expect(scenario.flow!.fingerprint).toBe(flows.flows[0].fingerprint)
  })
})
