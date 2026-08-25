import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  generateGuards,
  birthValidate,
  type BirthCandidate,
  type FlowWorkerTask,
} from '@truecourse/guard-generator'
import { autoResolutionKey, type GuardFlow, type Interface } from '@truecourse/shared'
import {
  loadScenarios,
  readGuardAutoResolutions,
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
  extractSessionBy,
  extractSessionOf,
  runGenerate,
  flowStageSeams,
  flowOfAllSession,
  flowPerClaimSession,
  flowWorkerSessionOf,
  submitWorkerSessions,
  matchAll,
  matchBy,
  cliInterface,
  interfacesOf,
  sessionSummary,
  EXTRACT_KIND,
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
const versionCliBgUntestable = extractSessionBy({ background: { untestable: 'design history, nothing observable' } })

/** Seed the standard one-doc repo. */
function seed(content = DOC_CONTENT, areaTags?: string[]): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, ...(areaTags ? { areaTags } : {}) }])
  writeDoc(r, DOC, content)
  return r
}

/** A worker that submits `scenario` for every task it is handed. */
const authorsEvery = (scenario = raw('v', PASSING_STEPS)) => submitWorkerSessions(() => scenario)

describe('generateGuards — extraction honesty + gaps', () => {
  it('records untestable sections as coverage gaps and guards the rest', async () => {
    const r = seed(DOC_CONTENT, ['tools/relkit'])

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(raw('relkit --version prints the version', PASSING_STEPS)),
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
  }, 60_000)

  it('records an api-driver claim as blocked-on when the recipe has no api block', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({
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
      extractSession: extractSessionBy({
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
      extractSession: versionCliBgUntestable,
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
      extractSession: versionCliBgUntestable,
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
      extractSession: extractSessionBy({}),
      flowsAreaSession: flowOfAllSession('the two-step path'),
      // The plan covers the first milestone and nothing else; the engine re-asks
      // once, then settles the STATED signal rather than authoring against a plan
      // that walks only half the path. (Matching is STILL a one-shot stage.)
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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    // cli still guards it; web is recorded as realizable-but-unrunnable.
    expect(res.written.map((w) => w.surface)).toEqual(['cli'])
    const gap = res.coverageGaps.find((g) => g.kind === 'awaiting-driver' && g.flowId === 'version')!
    expect(gap.surface).toBe('web')
    expect(gap.driver).toBe('web')
    expect(gap.reason).toContain('Needs web driver')
  }, 60_000)
})

describe('generateGuards — blocked-on world-state gaps', () => {
  /** A worker that ends `blocked` naming `capabilities`. */
  const blockedOn = (...capabilities: string[]) =>
    submitWorkerSessions(() => ({
      blocked: capabilities.map((capability, i) => ({ order: i + 1, capability })),
    }))

  it('records a blocked-on gap with normalized capabilities', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      // The flow needs world-state the sandbox can't express — no scenario, a reason.
      flowWorkerSession: blockedOn('Git', ' git ', 'DB'),
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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(raw('relkit --version', PASSING_STEPS)),
    })

    const entry = flowEntry(r, 'version')!
    expect(entry.scenarios.map((s) => s.drivers)).toEqual([['cli']])
    expect(entry.interfaces).toEqual([{ surface: 'cli', interfaceIds: ['cli/relkit'] }])
  }, 60_000)

  it('carries the matched interfaces forward on a no-op (unchanged) re-generate', async () => {
    const r = seed()
    const opts = {
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: blockedOn('db'),
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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: blockedOn('db'),
    }
    await runGenerate(opts)
    const before = flowEntry(r, 'version')!
    expect(before.gaps.map((g) => g.kind)).toEqual(['blocked-on'])

    const second = await runGenerate(opts)

    // The refusal was settled by the WORKER, which does not run for an unchanged
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
    const opts = {
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: blockedOn('db'),
    }
    await runGenerate(opts)

    // The hole an earlier generate left behind: a plan, a hash — and neither a test
    // nor a gap to account for the surface it planned.
    const manifest = readManifest(r)!
    writeManifest(r, { ...manifest, flows: manifest.flows.map((f) => ({ ...f, gaps: [] })) })
    expect(violatesSettleInvariant(readManifest(r)!.flows[0])).toBe(true)

    const res = await runGenerate(opts)

    // Its hash is disregarded — the entry is WORK again, so an existing hole is
    // closed on the next run instead of surviving forever.
    expect(res.flows.skipped).toBe(0)
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
      extractSession: extractSessionBy({}),
      // One flow authors a test, the other refuses — both must settle accounted for.
      flowWorkerSession: submitWorkerSessions((task) =>
        task.flowId === 'version'
          ? raw('relkit --version', PASSING_STEPS)
          : { blocked: [{ order: 1, capability: 'db' }] },
      ),
    })

    const flows = readManifest(r)!.flows
    expect(flows.map((f) => f.flowId).sort()).toEqual(['help', 'version'])
    expect(flows.filter((f) => violatesSettleInvariant(f))).toEqual([])
  }, 60_000)
})

// The retired one-shot arms this describe used to cover have no worker analog:
//  - "an authored scenario wins over a stray blockedOn list" — the outcome is a
//    DISCRIMINATED UNION now, so `settled` and `blocked` cannot both be claimed;
//  - "a reply with neither a scenario nor a blockedOn is re-asked once" — the
//    outcome schema is exhaustive and the loop's own malformed policy governs;
//  - "replays the blocked-on gap from the authoring cache" — the `guard/generate`
//    cache moved into core's seam (`tests/core/guard-generate-worker-seam.test.ts`).

describe('generateGuards — change detection', () => {
  it('does zero LLM work on a second run with an unchanged corpus', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    let extractCalls = 0
    let flowCalls = 0
    let matchCalls = 0
    let workerTasks = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({ background: { untestable: 'bg' } }, () => extractCalls++),
      flowsAreaSession: flowPerClaimSession(() => flowCalls++),
      matchRunner: matchAll(() => matchCalls++),
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS), {
        onBriefing: () => workerTasks++,
      }),
    })

    expect(res2.noChanges).toBe(true)
    expect(res2.written).toEqual([])
    // Matching and the worker pool see NO work at all. Extraction and synthesis
    // are still handed their docs/areas — their skipping moved into core's
    // cache (`tests/core/guard-generate-session-cache.test.ts`), which the stub
    // seams here do not model; the engine's own change detection is what these
    // two counters prove.
    expect([matchCalls, workerTasks]).toEqual([0, 0])
    expect([extractCalls, flowCalls]).toEqual([1, 1])
    // The flow is skipped, not re-settled: its committed scenario stands.
    expect(res2.flows).toMatchObject({ total: 1, skipped: 1, settled: 1, unsettled: 0 })
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
  }, 60_000)

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
      extractSession: extractSessionBy({}),
      matchRunner: perFlow,
      flowWorkerSession: authorsEvery(),
    })

    // `version`'s interface gained a flag; `help`'s is untouched.
    const worked: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['relkit', 'version'], ['--json']), twoInterfaces[1]),
      extractSession: extractSessionBy({}),
      matchRunner: perFlow,
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS), {
        onBriefing: (task) => worked.push(task.flowId),
      }),
    })

    expect(worked).toEqual(['version'])
    expect(res.flows).toMatchObject({ total: 2, skipped: 1 })
  }, 90_000)
})

describe('generateGuards — the committed scenario', () => {
  it('writes valid YAML carrying the flow, the interface path, and every bound section', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    // A worker never authors the engine-owned fields: a yaml carrying one is
    // REFUSED outright (the one-shot path silently overwrote it instead).
    let refusal = ''
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowsAreaSession: flowOfAllSession('a user checks the version then the help'),
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        refusal = (
          await task.runScenario(
            yaml.dump(
              {
                title: 'walks both',
                binds: { doc: 'other.md', section: 'nope', fingerprint: 'sha256:wrong' },
                steps: [
                  { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
                  { run: ['--version'], expect: { exit: 0 }, milestone: 2 },
                ],
              },
              { lineWidth: -1 },
            ),
          )
        ).content
        const accepted = await task.submitScenario(
          yaml.dump(
            {
              title: 'walks both',
              steps: [
                { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
                { run: ['--version'], expect: { exit: 0 }, milestone: 2 },
              ],
            },
            { lineWidth: -1 },
          ),
          [],
          async () => ({ kind: 'faithful' }),
        )
        const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })

    expect(refusal).toContain('engine-owned field(s) binds')

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
  }, 60_000)

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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(raw('generated', PASSING_STEPS)),
    })

    // The flow id is taken, so the collision fallback appends a counter.
    expect(res.written.map((w) => w.id)).toEqual(['version.2'])
    // The hand-written file is untouched.
    expect(fs.existsSync(path.join(scenariosDir(r), 'manual', 'version.yaml'))).toBe(true)
  }, 60_000)
})

describe('generateGuards — birth validation', () => {
  /** A runner that answers every scenario with the unserved-route annotation. */
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

  it('persists a scenario that passes at birth', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })
    expect(res.written).toHaveLength(1)
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(res.flows).toMatchObject({ total: 1, settled: 1, unsettled: 0 })
  }, 60_000)

  it('settles an `unservedRoute` birth outcome as a blocked-on gap, not an error', async () => {
    // The safety net for a flow the generate-time route gate could not classify:
    // birth ran it, the bound server 404ed a path ANOTHER app serves, and the runner
    // said so. That is the same fact Gate B blocks on, arriving later — it must
    // settle the flow (hash recorded, no re-authoring forever), never `errors.push`.
    //
    // On the worker path the observation arrives through the tool result, so the
    // engine records it per task and the fold routes any task that ends UNSETTLED
    // with one observed through the same `settleUnservedRoute` arm.
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
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
  }, 60_000)

  it('an unserved route WINS over the worker’s own verdict — a retirement settles as the gap, not the ledger', async () => {
    // The precedence the fold enforces: whatever the session concluded, an
    // execution that hit the unserved-route condition is the reason the flow
    // cannot be authored. No session — this one or the next generate's — can
    // author past a server the recipe does not declare, so it must not cost a
    // ledger retirement (and its taint) that re-attempts forever.
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      executor: unservedExecutor,
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        await task.runScenario(
          yaml.dump({ title: 'v', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }] }, { lineWidth: -1 }),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'nothing I author reaches it' } }
      }),
    })

    expect(res.errors).toEqual([])
    expect(res.coverageGaps.find((g) => g.kind === 'blocked-on' && g.flowId === 'version')?.reason).toContain(
      'missing-server',
    )
    expect(flowEntry(r, 'version')?.generationInputsHash).toEqual(expect.any(String))
    // The retirement arm never ran: no ledger bump, no taint.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[autoResolutionKey('version', 'cli')]).toBeUndefined()
    expect(ledger.tainted[autoResolutionKey('version', 'cli')]).toBeUndefined()
  }, 60_000)

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
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
      executor: refusingExecutor,
    })

    // ONE entry, at the run level, in the runner's grammar — no scenario is named.
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatchObject({ kind: 'refusal', message: refusal })
    expect(res.errors[0].message).not.toContain('birth validation error')
    expect(res.errors[0].flowId).toBeUndefined()

    // And recorded as the run-level fact it is, naming EVERY flow it cancelled —
    // the union over the tasks the refusal short-circuited, not just the one
    // whose round hit it.
    expect(res.refusal?.status).toBe('missing-external-env')
    expect(res.refusal?.flowIds.sort()).toEqual(['help', 'version'])

    // Nothing was validated, so nothing was written and no test was judged.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.flows).toMatchObject({ unsettled: 2 })
  })

  it('COMMITS a declared-red scenario as a failing test and settles the flow', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => ({ red: raw('always broken', FAILING_STEPS) })),
    })

    // The test is written like any other, with the status its confirmation run gave it.
    expect(res.written).toMatchObject([
      { id: 'version', flowId: 'version', surface: 'cli', status: 'failing' },
    ])
    expect(fs.existsSync(path.join(r, res.written[0].file))).toBe(true)
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])

    // Its run result is recorded exactly as a finding was, now naming the test.
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
    // The worker's own confirmed prediction IS the adjudication — no triage stage.
    expect(result.expectedRed).toMatchObject({ step: 1, verdict: 'code-drift' })

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
    expect(committed[0].diagnosis!.triage).toBeUndefined()
    expect(flowEntry(r, 'version')?.generationInputsHash).not.toBeNull()
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
  }, 60_000)

  it('re-generating a settled failing test is a no-op — no worker, no run', async () => {
    const r = seed()
    let workers = 0
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractSession: versionCliBgUntestable,
        flowWorkerSession: submitWorkerSessions(() => ({ red: raw('always broken', FAILING_STEPS) }), {
          onBriefing: () => workers++,
        }),
      })

    await run()
    expect(workers).toBe(1)

    const second = await run()
    expect(workers).toBe(1) // unchanged inputs → no second worker session
    expect(second.noChanges).toBe(true)
    expect(second.flows.skipped).toBe(1)
    // The committed red test — its status AND its diagnosis — stand.
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(flowEntry(r, 'version')?.scenarios).toMatchObject([
      { id: 'version', drivers: ['cli'], status: 'failing', diagnosis: { title: 'always broken' } },
    ])
  }, 60_000)

  it('a failing flow NEVER withholds a healthy sibling — persist is independent', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) =>
        task.flowId === 'version' ? raw('good', PASSING_STEPS) : { red: raw('bad', FAILING_STEPS) },
      ),
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
  }, 90_000)

  it('attributes a finding to the FAILING milestone and marks a broken chain', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    // A composite flow whose SECOND milestone fails: milestone 1 ran green first, so
    // the chain broke mid-path — the "milestones don't chain" category.
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}), // one claim per section, named `<anchor> claim`
      flowsAreaSession: flowOfAllSession('the two-step path'),
      flowWorkerSession: submitWorkerSessions(
        () => ({
          red: raw('chain', [
            { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
            { run: ['boom'], expect: { exit: 0 }, milestone: 2 },
          ]),
        }),
      ),
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
  }, 60_000)

  it('a first-milestone failure is NOT a composition finding', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => ({ red: raw('broken', FAILING_STEPS) })),
    })

    const finding = res.birthFindings[0]
    expect(finding.failedMilestone).toBe(1)
    expect(finding.priorMilestonesPassed).toBe(false)
    expect(isCompositionFinding(finding)).toBe(false)
  }, 60_000)
})

describe('generateGuards — failure output excerpts', () => {
  it('a committed red carries the failing run raw stderr; the empty stdout is omitted', async () => {
    const r = seed()

    // FAILING_STEPS runs `boom` → exit 7, stderr "fatal: intentional failure".
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => ({ red: raw('always broken', FAILING_STEPS) })),
    })
    const finding = res.birthFindings[0]
    expect(finding.stderr).toContain('fatal: intentional failure')
    expect(finding.stdout).toBeUndefined()
  }, 60_000)

  it('the worker sees the same output in the tool result it revises on', async () => {
    const r = seed()

    let report = ''
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        const yamlText = yaml.dump(
          { title: 'broken', steps: [{ run: ['boom'], expect: { exit: 0 }, milestone: 1 }] },
          { lineWidth: -1 },
        )
        report = (await task.runScenario(yamlText)).content
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'probe only' } }
      }),
    })

    expect(report).toContain('FAIL at step 1')
    expect(report).toContain('fatal: intentional failure')
  }, 60_000)
})

// `retryCacheKey` and its evidence-sensitivity cases are RETIRED with the
// birth-retry round (plan 04 step 20): the worker revises in-loop, on the tool
// result the case above pins, so there is no second-round cache key.

describe('generateGuards — dismissals (decisions.json)', () => {
  // Two cli claims in ONE section, composed into one flow: dismissing one changes
  // the flow's composition, which is the whole point of the milestone identity.
  const twoClaims = extractSessionBy({
    version: [{ claim: 'CLAIM_BAD' }, { claim: 'CLAIM_GOOD' }],
    background: { untestable: 'bg' },
  })

  it('findings carry their authored YAML and the extracted claim text', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: twoClaims,
      flowsAreaSession: flowOfAllSession('the bad path'),
      flowWorkerSession: submitWorkerSessions(() => ({ red: raw('bad', FAILING_STEPS) })),
    })

    const finding = res.birthFindings.find((f) => f.title === 'bad')!
    expect(finding.claim).toBe('CLAIM_BAD')
    expect(finding.yaml).toContain('title: bad')
    expect(finding.yaml).toContain('section: version')
  }, 60_000)

  it('dismissing a claim drops its milestone, records a gap, and re-synthesizes the flow', async () => {
    const r = seed()
    const runOnce = () =>
      runGenerate({
        repoRoot: r,
        extractSession: twoClaims,
        flowsAreaSession: flowOfAllSession('the whole path'),
        // The flow's milestone count DROPS with the dismissal; the stub follows
        // the task's own `milestoneCount`, so it never over-stamps.
        flowWorkerSession: submitWorkerSessions(() => raw('walks it', PASSING_STEPS)),
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
  }, 90_000)

  it('dismissing the claim a FAILING test asserts removes the test file next generate', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractSession: versionCliBgUntestable,
        flowWorkerSession: submitWorkerSessions(() => ({ red: raw('always broken', FAILING_STEPS) })),
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
  }, 90_000)

  it('a dismissal whose claim text no longer matches any live claim surfaces as orphaned', async () => {
    const r = seed()

    dismissGuardClaim(r, { doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT', dismissedAt: '2026-07-08T00:00:00.000Z' })

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.orphanedDismissals).toEqual([{ doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT' }])
    // The live claim is unaffected — it authors + commits normally.
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  }, 60_000)

  it('a dismissed FLOW is dropped with its scenarios and settles as a dismissed gap', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractSession: versionCliBgUntestable,
        flowWorkerSession: authorsEvery(),
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
  }, 60_000)

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

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.orphanedFlowDismissals).toEqual([{ flowId: 'a-flow-that-was-recomposed', title: 'gone' }])
    expect(res.written).toHaveLength(1) // the live flow is unaffected
  }, 60_000)
})

describe('generateGuards — capability/materialization errors', () => {
  // A scenario declaring a git commit of a file it never seeded via `setup.files`
  // fails materialization with a precise provider message. The retry ROUND is gone
  // (plan 04 step 20) — the message now comes back as the worker's tool error and
  // the session revises in-loop.
  const UNSEEDED_GIT = { git: { commits: [{ files: ['README.md'] }] } }

  it('hands the capability message to the worker as a tool error, and the fix persists', async () => {
    const r = seed()

    let firstReport = ''
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        // Round 1: a git commit of an unseeded file → materialization fails.
        firstReport = (
          await task.runScenario(
            yaml.dump(
              { title: 'broken', setup: UNSEEDED_GIT, steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }] },
              { lineWidth: -1 },
            ),
          )
        ).content
        const accepted = await task.submitScenario(
          yaml.dump({ title: 'fixed', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }] }, { lineWidth: -1 }),
          [],
          async () => ({ kind: 'faithful' }),
        )
        const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })

    // The git provider's precise message reached the session verbatim.
    expect(firstReport).toContain('declared file does not exist in the sandbox: README.md')
    expect(firstReport).toContain('seed it via setup.files')
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
  }, 60_000)

  it('leaves the flow unsettled when the worker never gets past the materialization error', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        const yamlText = yaml.dump(
          { title: 'broken', setup: UNSEEDED_GIT, steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }] },
          { lineWidth: -1 },
        )
        await task.runScenario(yamlText)
        await task.runScenario(yamlText)
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'setup cannot be materialized' } }
      }),
    })

    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(flowEntry(r, 'version')?.generationInputsHash).toBeNull()
  }, 60_000)
})

describe('generateGuards — extraction failures (fail-soft)', () => {
  it('records a per-document extraction failure; other docs continue', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: TWO_CLI_DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: async ({ docs }) => ({
        byDoc: new Map(
          docs.map((doc) =>
            doc.doc === DOC
              ? [doc.doc, { ok: false as const, reason: 'extraction session failed: the provider is gone' }]
              : [
                  doc.doc,
                  {
                    ok: true as const,
                    complete: true,
                    failedViews: 0,
                    data: {
                      claims: doc.sections.map((s) => ({
                        claim: 'c',
                        driver: 'cli' as const,
                        sectionAnchor: s.anchor,
                        reason: 'exit',
                      })),
                      untestable: [],
                    },
                  },
                ],
          ),
        ),
        summary: sessionSummary(EXTRACT_KIND, { ran: docs.length, failed: 1, allTransport: false }),
      }),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
    })

    expect(res.status).toBe('ok') // fail-soft: never throws
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    // The other doc's claims still compose into flows and settle.
    expect(res.written.map((w) => w.flowId).sort()).toEqual(['help', 'version'])
    // The failed doc contributed no claim, so no flow binds it — nothing to settle.
    expect(manifestSections(r).some((s) => s.doc === DOC)).toBe(false)
  }, 90_000)

  it('an all-doc extraction loss records every doc and writes nothing', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionOf(
        new Map([[DOC, { ok: false as const, reason: 'extraction session failed: call failed' }]]),
        { ran: 1, failed: 1 },
      ),
    })

    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.extractionFailures[0].reason).toMatch(/call failed/)
    expect(res.written).toEqual([])
  })
})

describe('generateGuards — worker robustness', () => {
  it('one flow’s worker failure never costs its siblings their scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        if (task.flowId === 'version') return { kind: 'failed', reason: 'the transport exploded' }
        const accepted = await task.submitScenario(
          yaml.dump({ title: 'help works', steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }] }, { lineWidth: -1 }),
          [],
          async () => ({ kind: 'faithful' }),
        )
        const sha = /under sha ([0-9a-f]{64})/.exec(accepted.content)![1]
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['help'])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    expect(flowEntry(r, 'version')?.generationInputsHash).toBeNull()
    expect(flowEntry(r, 'help')?.scenarios).toEqual([{ id: 'help', drivers: ['cli'], status: 'passing' }])
  }, 60_000)

  it('an invalid `matches` regex never reaches a sandbox — the pre-flight names it', async () => {
    const r = seed()
    let report = ''
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task: FlowWorkerTask) => {
        report = (
          await task.runScenario(
            yaml.dump(
              {
                title: 'version prints',
                steps: [{ run: ['--version'], expect: { stdout: { matches: '1\\.[0-9' } }, milestone: 1 }],
              },
              { lineWidth: -1 },
            ),
          )
        ).content
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'bad pattern' } }
      }),
    })

    expect(report).toContain('pre-flight defect (not executed)')
    expect(report).toContain('is not a valid regular expression')
    expect(res.written).toEqual([])
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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
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
  }, 60_000)

  it('PRUNES an orphaned flow with no test — its stale gaps die with it', async () => {
    const r = seed()
    const seams = {
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    }
    // A first, ordinary generate — `version` settles and flows.json is written.
    await runGenerate({ repoRoot: r, ...seams })
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
    const res = await runGenerate({ repoRoot: r, ...seams })

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
  }, 60_000)

  it('the report round-trips through the schema, flow counts included', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })
    expect(() => GuardGenerateReportSchema.parse({ ...res, generatedAt: '2026-07-25T00:00:00.000Z' })).not.toThrow()
  }, 60_000)

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
    const res = await generateGuards({ repoRoot: r, ...flowStageSeams(r) })
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
    const res = await generateGuards({ repoRoot: r, ...flowStageSeams(r) })
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
      ...flowStageSeams(r),
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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    expect(fs.existsSync(path.join(scenariosDir(r), 'recipe.json'))).toBe(true)
    expect(res.written).toHaveLength(1)
  }, 60_000)

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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    const written = JSON.parse(fs.readFileSync(path.join(scenariosDir(r), 'recipe.json'), 'utf-8'))
    expect(written.install).toBe('touch install-marker')
    expect(written.build).toBe('test -f install-marker')
  }, 60_000)

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
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
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
  }, 60_000)
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
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
      onInterfaces: (interfaces, surfaces) => (mapped = [interfaces, surfaces]),
      onFlowProgress: (done, total) => flows.push([done, total]),
      onMatchProgress: (done, total) => matches.push([done, total]),
    })

    expect(res.written).toHaveLength(2)
    expect(mapped).toEqual([2, 1]) // two cli interfaces, one surface
    expect(flows).toEqual([[0, 1], [1, 1]]) // one area, announced then settled
    // Two flows × one matchable surface — the denominator is known up front.
    expect(matches).toEqual([[0, 2], [1, 2], [2, 2]])
  }, 90_000)

  it('fires onExtractProgress with the planned total upfront, then once per doc', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '# Alpha\n\nRunning with --version prints the version.\n')
    writeDoc(r, 'docs/b.md', '# Beta\n\nRunning with --version prints the version.\n')

    const docs: Array<[number, number]> = []
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
      onExtractProgress: (done, total) => docs.push([done, total]),
    })

    // Two docs → one session each. The planned denominator is announced up front
    // (0/2 before any call), then the counter ticks per DOC (the session unit).
    expect(docs).toEqual([[0, 2], [1, 2], [2, 2]])
  }, 90_000)

  it('fires onWorkerProgress with the pool total and the running settled/blocked tally', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const ticks: { done: number; total: number; settled: number; blocked: number }[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) =>
        task.flowId === 'version' ? raw('good', PASSING_STEPS) : { blocked: [{ order: 1, capability: 'db' }] },
      ),
      onWorkerProgress: (p) => ticks.push(p),
    })

    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // Announced (0/2), then one tick per settled worker, carrying the live tally.
    expect(ticks[0]).toMatchObject({ done: 0, total: 2 })
    expect(ticks.at(-1)).toMatchObject({ done: 2, total: 2, settled: 1, blocked: 1 })
  }, 90_000)

  it('fires onFlowSettled per flow, and an unsettled flow still ticks (its gaps are recorded)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const ticks: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) =>
        task.flowId === 'version' ? raw('good', PASSING_STEPS) : { red: raw('bad', FAILING_STEPS) },
      ),
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
  }, 90_000)
})

describe('generateGuards — grounded authoring', () => {
  it('captures real behavior and puts the transcripts in the worker briefing', async () => {
    const r = seed()

    let briefing = ''
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'bg' },
      }),
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS), {
        onBriefing: (_t, text) => (briefing = text),
      }),
    })

    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // The claim named `--version`; relkit prints 2.4.1 at exit 0 in the empty sandbox.
    expect(briefing).toContain('--version')
    expect(briefing).toContain('2.4.1')
    expect(briefing).toContain('exit 0')
  }, 60_000)

  it('briefs ungrounded (no probe block) when the recipe build fails', async () => {
    const r = repo()
    writeRecipe(r, { build: 'false' }) // build fails → no probing
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let briefing = ''
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS), {
        onBriefing: (_t, text) => (briefing = text),
      }),
    })

    // The worker was still briefed, but with no transcripts; execution then errors
    // on the broken build so nothing settles.
    expect(briefing).not.toContain('2.4.1')
    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  }, 60_000)

  it('runs the recipe install before the build (the build sees the install marker)', async () => {
    const r = repo()
    // The build only succeeds when the install already ran → order proven.
    writeRecipe(r, { install: 'touch marker', build: 'test -f marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.errors).toEqual([])
  }, 60_000)

  it('errors on execution when the recipe install fails (exactly like a failing build)', async () => {
    const r = repo()
    writeRecipe(r, { install: 'false', build: 'true' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  }, 60_000)

  it('fires onGroundProgress as probes are planned then captured', async () => {
    const r = seed()

    const ground: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'bg' },
      }),
      flowWorkerSession: authorsEvery(),
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
  }, 60_000)
})

describe('generateGuards — the per-flow pipeline', () => {
  it('settles every flow, each with a stable manifest entry', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')

    const res = await runGenerate({
      repoRoot: r,
      concurrency: 4, // both flows work concurrently
      extractSession: extractSessionBy({}), // one cli claim per doc → two independent flows
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
    })

    expect(res.written.map((w) => w.flowId).sort()).toEqual(['alpha', 'beta'])
    expect(flowEntry(r, 'alpha')?.scenarios).toEqual([{ id: 'alpha', drivers: ['cli'], status: 'passing' }])
    expect(flowEntry(r, 'beta')?.scenarios).toEqual([{ id: 'beta', drivers: ['cli'], status: 'passing' }])
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha', 'beta'])
    expect(fs.existsSync(path.join(scenariosDir(r), 'a', 'alpha.yaml'))).toBe(true)
  }, 90_000)

  it('kicks the recipe build at run start, before the worker pool', async () => {
    const r = repo()
    // The build writes a marker in the repo root; the worker checks for it.
    writeRecipe(r, { build: 'touch build-marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let sawMarker = false
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS), {
        onBriefing: () => {
          sawMarker = fs.existsSync(path.join(r, 'build-marker'))
        },
      }),
    })
    expect(sawMarker).toBe(true)
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  }, 60_000)

  it('a flow reuses its own prior id and never steals a sibling’s', async () => {
    const r = repo()
    writeRecipe(r)
    // Two docs whose sections share the heading leaf "limits" → the flow ids are
    // disambiguated by synthesis, and each keeps its own scenario id across re-runs.
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## limits\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## limits\n`relkit --version` exits 0.\n')

    const opts = {
      repoRoot: r,
      concurrency: 4,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => raw(task.flowId, PASSING_STEPS)),
    }
    const first = await runGenerate(opts)
    const ids = first.written.map((w) => w.id).sort()
    expect(ids).toEqual(['limits', 'limits-2'])

    // Re-run against a STALE manifest: both flows re-author and must land on the
    // SAME ids (each frees its own before assigning), never colliding.
    writeManifest(r, {
      flows: readManifest(r)!.flows.map((f) => ({ ...f, generationInputsHash: 'sha256:stale' })),
    })
    const second = await runGenerate(opts)
    expect(second.written.map((w) => w.id).sort()).toEqual(ids)
    expect(new Set(loadScenarios(r).scenarios.map((s) => s.id)).size).toBe(2)
  }, 90_000)

  it('stops after synthesis when the internal seam asks it to', async () => {
    const r = seed()
    let matchCalls = 0

    const res = await runGenerate({
      repoRoot: r,
      stopAfterFlows: true,
      extractSession: versionCliBgUntestable,
      matchRunner: matchAll(() => matchCalls++),
    })

    expect(matchCalls).toBe(0)
    expect(res.written).toEqual([])
    expect(res.flows.total).toBe(1)
    // The flow corpus IS written — that is the artifact the seam exists to produce.
    expect(fs.existsSync(path.join(scenariosDir(r), 'flows.json'))).toBe(true)
  })
})

// `spawnGenerateRunner` and its `guard.retry` stage attribution are RETIRED
// (plan 04 step 20): authoring is a session, so there is no per-stage transport
// request and no retry stage to attribute. The one-model rule for session stages
// is pinned in `tests/core/llm-transport-models.test.ts`.

describe('generateGuards — the committed flow corpus', () => {
  it('writes flows.json and references its flows by id from the scenarios', async () => {
    const r = seed()

    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: authorsEvery(),
    })

    const flows = JSON.parse(fs.readFileSync(path.join(scenariosDir(r), 'flows.json'), 'utf-8'))
    expect(flows.flows.map((f: { id: string }) => f.id)).toEqual(['version'])
    const scenario = yaml.load(
      fs.readFileSync(path.join(scenariosDir(r), 'cli', 'version.yaml'), 'utf-8'),
    ) as GuardScenario
    expect(scenario.flow!.id).toBe('version')
    expect(scenario.flow!.fingerprint).toBe(flows.flows[0].fingerprint)
  }, 60_000)
})
