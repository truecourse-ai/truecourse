import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  interfaceFingerprint,
  type ApiRequestContract,
  type GuardExpectedRed,
  type DetectedExternalService,
  type OutboundRequest,
  type GuardScenario,
  type Interface,
} from '@truecourse/shared'
import {
  generateGuards,
  type ExtractResult,
  type ExtractSessionSeam,
  type ExtractedClaimWithNeeds,
  type FlowSet,
  type FlowSynthesisArea,
  type FlowsAreaSessionResult,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionSeam,
  type FlowWorkerSessionResult,
  type FlowWorkerSessionSeam,
  type FlowWorkerTask,
  type GenerateGuardsOptions,
  type GuardGenerateResult,
  type GuardSessionSummary,
  type InterfaceProvider,
  type MatchRunner,
  type RawGeneratedApiScenario,
  type RawGeneratedCliScenario,
  type RawGeneratedScenario,
  type SeedDraftDatabase,
  type UntestableNote,
  type WorkerFidelityJudge,
} from '@truecourse/guard-generator'

/** The realistic fixture CLI (`relkit`) shared with the guard-runner engine tests. */
export const FIXTURE_BIN = fileURLToPath(
  new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url),
)

export function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gen-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-fixture-repo', version: '0.0.0', bin: { relkit: 'bin.mjs' } }, null, 2),
  )
  return dir
}

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Write a `recipe.json` whose entry invokes the fixture CLI with a no-op build. */
export function writeRecipe(
  repo: string,
  overrides: {
    install?: string
    build?: string
    entry?: string[]
    /** The web driver's preparation layer — present when a case authors web. */
    web?: { serve: string[]; cwd?: string; healthPath?: string }
  } = {},
): void {
  const recipe = {
    ...(overrides.install ? { install: overrides.install } : {}),
    build: overrides.build ?? 'true',
    entry: overrides.entry ?? ['node', FIXTURE_BIN],
    ...(overrides.web ? { web: overrides.web } : {}),
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
}

export function writeDoc(repo: string, rel: string, content: string): void {
  const target = path.join(repo, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** Seed a tolerant `corpus.json` so the doc universe includes `docs`. */
export function writeCorpus(repo: string, docs: { ref: string; areaTags?: string[] }[]): void {
  const target = path.join(repo, '.truecourse', 'specs', 'corpus.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: docs.map((d) => ({ ref: d.ref, kind: 'prd', lastTouched: '', areaTags: d.areaTags ?? [] })),
      areas: [],
      relations: [],
    }),
  )
}

/** The live binding (doc + anchor + fingerprint) for a section by its heading text. */
export function bindsFor(repo: string, docRel: string, headingText: string): GuardScenario['binds'] {
  const content = fs.readFileSync(path.join(repo, docRel), 'utf-8')
  const section = buildDocSectionIndex(docRel, content).sections.find((s) => s.headingText === headingText)
  if (!section) throw new Error(`no section "${headingText}" in ${docRel}`)
  return [{ doc: docRel, section: section.anchor, fingerprint: section.fingerprint }]
}

/** A raw generated CLI scenario as a model would return it (behavioral fields only). */
export function raw(
  title: string,
  steps: RawGeneratedCliScenario['steps'],
  extra: Partial<RawGeneratedScenario> = {},
): RawGeneratedScenario {
  return { title, steps, ...extra }
}

/** A scenario running `--version` and expecting exit 0 (passes against relkit). */
export const PASSING_STEPS: RawGeneratedCliScenario['steps'] = [{ run: ['--version'], expect: { exit: 0 } }]
/** A scenario running `boom` but expecting exit 0 (relkit exits 7 → fails). */
export const FAILING_STEPS: RawGeneratedCliScenario['steps'] = [{ run: ['boom'], expect: { exit: 0 } }]

// ---------------------------------------------------------------------------
// Interfaces (the code half)
// ---------------------------------------------------------------------------

/** One cli interface over a command path — the shape the mapper derives. */
export function cliInterface(command: string[], flags: string[] = []): Interface {
  const shape = {
    type: 'cli' as const,
    entry: { command },
    steps: [{ kind: 'invoke' as const, command, flags }],
  }
  return {
    id: `cli/${command.join('-') || 'root'}`,
    title: command.join(' '),
    ...shape,
    fingerprint: interfaceFingerprint(shape),
  }
}

/** One api interface over an operation — the shape the api mapper derives. */
export function apiInterface(method: string, apiPath: string): Interface {
  const shape = {
    type: 'api' as const,
    entry: { method, path: apiPath },
    steps: [{ kind: 'request' as const, method, path: apiPath }],
  }
  return {
    id: `api/${method.toLowerCase()}${apiPath.replace(/\W+/g, '-')}`,
    title: `${method} ${apiPath}`,
    ...shape,
    fingerprint: interfaceFingerprint(shape),
  }
}

/**
 * Write the interface snapshot production's mapper writes (`guard/interfaces.json`) —
 * the file the pre-flight estimate reads to know what the surfaces look like.
 */
export function writeInterfaceSnapshot(repo: string, interfaces: Interface[]): void {
  const target = path.join(repo, '.truecourse', 'guard', 'interfaces.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({ version: 2, generatedAt: '2026-01-01T00:00:00Z', recipeFingerprint: '', interfaces }, null, 2),
  )
}

/** An interface provider over an explicit catalog, snapshotting it exactly as the
 *  real (analyzer-backed) mapper does so the estimate sees the same surfaces. */
export function interfacesOf(repo: string, ...interfaces: Interface[]): InterfaceProvider {
  return async () => {
    writeInterfaceSnapshot(repo, interfaces)
    return { interfaces }
  }
}

/**
 * The same catalog, plus the third parties a detector would have found —
 * both ride ONE provider in production because both come from one analysis pass.
 */
export function withExternalServices(
  provider: InterfaceProvider,
  ...services: {
    service: string
    category?: DetectedExternalService['category']
    /** The base-URL env var the detector saw, when it saw one. */
    baseUrlEnv?: string
    /** Every override variable the detector saw, best-confidence first. */
    baseUrlEnvs?: DetectedExternalService['baseUrlEnvs']
    source?: DetectedExternalService['source']
  }[]
): InterfaceProvider {
  return async () => ({
    ...(await provider()),
    externalServices: services.map((s) => ({ ...s, evidence: [{ filePath: 'src/x.ts', importSource: s.service }] })),
  })
}

/**
 * The same catalog, plus the code-truth grounding the analyzer would have harvested
 * — the inbound contract per operation and the app's own outbound request
 * construction. One provider again: production derives all of it from one pass.
 */
export function withCodeTruth(
  provider: InterfaceProvider,
  grounding: { requestContracts?: ApiRequestContract[]; outboundRequests?: OutboundRequest[] },
): InterfaceProvider {
  return async () => {
    const mapped = await provider()
    // The inbound contract has ONE home now (plan item 102): the operation it
    // belongs to. The helper keeps its `ApiRequestContract[]` ergonomics and
    // writes them onto the catalog exactly as `mapInterfaces` does.
    const byOperation = new Map(
      (grounding.requestContracts ?? []).map((c) => [`${c.method.toUpperCase()} ${c.path}`, c] as const),
    )
    const interfaces = mapped.interfaces.map((iface) => {
      const entry = iface.entry as { method?: string; path?: string }
      if (iface.type !== 'api' || !entry.method || !entry.path) return iface
      const contract = byOperation.get(`${entry.method.toUpperCase()} ${entry.path}`)
      if (!contract) return iface
      return {
        ...iface,
        contract: {
          surface: 'api' as const,
          operation: {
            request: {
              ...(contract.queryFields ? { query: contract.queryFields.map((f) => ({ ...f })) } : {}),
              ...(contract.bodyFields ? { body: contract.bodyFields.map((f) => ({ ...f })) } : {}),
            },
          },
        },
      }
    })
    return {
      ...mapped,
      interfaces,
      ...(grounding.outboundRequests ? { outboundRequests: grounding.outboundRequests } : {}),
    }
  }
}

/**
 * The same catalog, plus the datastore + parsed schema the analyzer would have
 * found — one provider, because production derives both from one pass.
 */
export function withDatabase(provider: InterfaceProvider, database: SeedDraftDatabase | null): InterfaceProvider {
  return async () => ({ ...(await provider()), database })
}

/** The default catalog: the fixture CLI's two commands. */
export const DEFAULT_INTERFACES = (repo: string): InterfaceProvider =>
  interfacesOf(repo, cliInterface(['relkit']), cliInterface(['relkit', 'boom']))

// ---------------------------------------------------------------------------
// The SESSION SEAMS (plan 04). The one-shot runners are retired: `generateGuards`
// now takes four REQUIRED seams, and a test states the answers those seams give
// instead of the replies a runner returned. Every stub below is deliberately
// shallow — it fabricates an ANSWER; nothing about the pool, the cache or the
// driver is faked here (those are covered against the real seams in
// `tests/core/guard-generate-*.test.ts`).
// ---------------------------------------------------------------------------

/** A zero-spend summary for a stubbed seam — override what a case is about. */
export function sessionSummary(kind: string, over: Partial<GuardSessionSummary> = {}): GuardSessionSummary {
  return {
    kind,
    ran: 0,
    fromCache: 0,
    failed: 0,
    allTransport: true,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
    ...over,
  }
}

export const EXTRACT_KIND = 'guard-generate.extract'
export const FLOWS_KIND = 'guard-generate.flows'
export const WORKER_KIND = 'guard-generate.flow-worker'

/** How a section's claims are described in an {@link extractSessionBy} spec. */
export type ClaimSpec =
  | Array<{ claim?: string; driver?: 'cli' | 'api' | 'web' | 'tui' | 'library'; reason?: string; needs?: ExtractedClaimWithNeeds['needs'] }>
  | { untestable: string }

/**
 * The claim-extraction SEAM driven by a per-anchor claim map: for every section
 * of every doc it is handed, either that section's claims or its untestable
 * note. Sections absent from the map yield one default cli claim (so
 * "everything testable" is the default) — the shape {@link extractBy}'s runner
 * had, moved onto the seam.
 */
export function extractSessionBy(
  byAnchor: Record<string, ClaimSpec>,
  onDoc?: (doc: string) => void,
): ExtractSessionSeam {
  return async ({ docs, onDoc: tick }) => {
    const byDoc = new Map<string, ExtractResult>()
    let done = 0
    tick?.(0, docs.length)
    for (const doc of docs) {
      onDoc?.(doc.doc)
      const claims: ExtractedClaimWithNeeds[] = []
      const untestable: UntestableNote[] = []
      for (const section of doc.sections) {
        const spec = byAnchor[section.anchor] ?? [{}]
        if (Array.isArray(spec)) {
          for (const c of spec) {
            claims.push({
              claim: c.claim ?? `${section.anchor} claim`,
              driver: c.driver ?? 'cli',
              sectionAnchor: section.anchor,
              reason: c.reason ?? 'exit code is observable',
              ...(c.needs ? { needs: c.needs } : {}),
            })
          }
        } else {
          untestable.push({ sectionAnchor: section.anchor, reason: spec.untestable })
        }
      }
      byDoc.set(doc.doc, { ok: true, data: { claims, untestable }, complete: true, failedViews: 0 })
      tick?.(++done, docs.length)
    }
    return { byDoc, summary: sessionSummary(EXTRACT_KIND, { ran: docs.length }) }
  }
}

/** An extraction seam that answers from an explicit per-doc map. */
export function extractSessionOf(
  byDoc: Map<string, ExtractResult>,
  summary: Partial<GuardSessionSummary> = {},
): ExtractSessionSeam {
  return async () => ({
    byDoc,
    summary: sessionSummary(EXTRACT_KIND, { ran: byDoc.size, ...summary }),
  })
}

// --- Flow synthesis ---------------------------------------------------------

/**
 * The per-area flow-synthesis seam over a plain answer function. A returned
 * `FlowSet` is folded as a successful session; a `{ ok: false }` result is a
 * failed one. `inputsKey` defaults to a stable per-area string so the produced
 * flows carry a `synthesisInputsHash` a test can assert on.
 */
export function flowsAreaSessionOf(
  answer: (area: FlowSynthesisArea) => FlowSet | FlowsAreaSessionResult,
  over: { summary?: Partial<GuardSessionSummary>; inputsKey?: (area: FlowSynthesisArea) => string } = {},
): FlowsAreaSessionSeam {
  return async ({ areas, onArea }) => {
    const byArea = new Map<string, FlowsAreaSessionResult>()
    for (const area of areas) {
      const given = answer(area)
      const result: FlowsAreaSessionResult =
        'flows' in given
          ? { ok: true, value: given, inputsKey: over.inputsKey?.(area) ?? `key:${area.areaId}` }
          : given
      byArea.set(area.areaId, result)
      onArea?.(area.areaId)
    }
    return { byArea, summary: sessionSummary(FLOWS_KIND, { ran: areas.length, ...over.summary }) }
  }
}

/**
 * Flow synthesis fake: ONE atomic flow per claim, titled from the claim's anchor —
 * so a flow's id IS the anchor slug and its scenarios read `<anchor>.<surface>.<n>`.
 * The default for tests that care about a claim, not a composition.
 */
export function flowPerClaimSession(onArea?: (areaId: string) => void): FlowsAreaSessionSeam {
  return flowsAreaSessionOf((area) => {
    onArea?.(area.areaId)
    return {
      flows: area.claims.map((c) => ({
        title: c.anchor,
        goal: `verify ${c.title}`,
        milestones: [{ order: 1, doc: c.doc, anchor: c.anchor, claimTitle: c.title }],
      })),
      noFlowClaims: [],
    }
  })
}

/** Flow synthesis fake: ONE composite flow chaining every claim of the area, in
 *  the order the claims were given — the multi-milestone path. */
export function flowOfAllSession(title: string, onArea?: (areaId: string) => void): FlowsAreaSessionSeam {
  return flowsAreaSessionOf((area) => {
    onArea?.(area.areaId)
    if (area.claims.length === 0) return { flows: [], noFlowClaims: [] }
    return {
      flows: [
        {
          title,
          goal: `walk ${area.claims.length} milestone(s)`,
          milestones: area.claims.map((c, i) => ({ order: i + 1, doc: c.doc, anchor: c.anchor, claimTitle: c.title })),
        },
      ],
      noFlowClaims: [],
    }
  })
}

/** An epic pass that never chains anything (the default answer). */
export const noEpicSessions: FlowsEpicSessionSeam = async () => ({
  result: { ok: true, value: { epics: [] }, inputsKey: 'key:epic' },
  summary: sessionSummary(FLOWS_KIND, { ran: 1 }),
})

// --- The flow worker --------------------------------------------------------

/**
 * The flow-worker seam over a per-task handler. The handler drives the engine
 * closures (`task.runScenario` / `task.submitScenario`) exactly as a session
 * would and returns the outcome the fold routes; `undefined` means "no result
 * for this task", which is what the settle invariant is meant to catch.
 */
export function flowWorkerSessionOf(
  handler: (task: FlowWorkerTask) => Promise<FlowWorkerSessionResult | undefined>,
  over: { summary?: Partial<GuardSessionSummary>; fidelitySummary?: GuardSessionSummary } = {},
): FlowWorkerSessionSeam {
  return async ({ tasks, epicTasks, onTask }) => {
    const byTask = new Map<string, FlowWorkerSessionResult>()
    const all = [...tasks, ...epicTasks]
    let done = 0
    onTask?.(0, all.length)
    // Two WAVES, like the real seam: every non-epic settles before an epic starts.
    for (const wave of [tasks, epicTasks]) {
      for (const task of wave) {
        const result = await handler(task)
        if (result) byTask.set(task.workItem, result)
        onTask?.(++done, all.length, result?.kind === 'outcome' ? result.outcome.kind : result ? 'failed' : undefined)
      }
    }
    return {
      byTask,
      summary: sessionSummary(WORKER_KIND, { ran: all.length, ...over.summary }),
      ...(over.fidelitySummary ? { fidelitySummary: over.fidelitySummary } : {}),
    }
  }
}

/** A worker seam that must never be reached (`stopAfterFlows` tests). */
export const noWorkerSessions: FlowWorkerSessionSeam = async () => {
  throw new Error('the flow-worker seam should not have been reached')
}

/** The sha the engine's acceptance message names for a stashed submission.
 *  (The stash keys on the ENGINE's serialization of the built scenario, not on
 *  the yaml the session submitted — so a stub must read it back, never hash.) */
export function acceptedSha(report: { content: string }): string | null {
  return /under sha ([0-9a-f]{64})/.exec(report.content)?.[1] ?? null
}

/** What a {@link submitWorkerSessions} entry may say about one (flow, surface). */
export type WorkerSpec =
  | RawGeneratedScenario
  | { scenario: RawGeneratedScenario; expectedReds: GuardExpectedRed[] }
  /**
   * A scenario the author expects to FAIL, declared the honest way: submit once
   * to observe the red, copy the observed actual into `expectedReds`, submit
   * again. That two-step is exactly what the engine's prediction gate demands
   * of a real worker ("the prediction proves you ran it").
   */
  | { red: RawGeneratedScenario; verdict?: GuardExpectedRed['verdict']; brief?: string }
  | { blocked: { order: number; capability: string }[] }
  | { journeyDefect: { interfaceId: string; detail: string } }
  | { retired: { attempts: number; lastEvidence: string } }

/** The `actual:` line of the engine's condensed run report — what a worker
 *  copies into `predictedActual`. */
export function observedActual(report: { content: string }): string {
  return /^actual:\s+(.*)$/m.exec(report.content)?.[1] ?? ''
}

/** The step the engine's condensed report says execution stopped at. */
export function observedStep(report: { content: string }): number {
  return Number(/at step (\d+)/.exec(report.content)?.[1] ?? 1)
}

/**
 * A worker seam that behaves like a well-behaved SESSION: it submits one
 * scenario per task through the engine's own `submit_scenario` closure, reads
 * the accepted sha out of the engine's answer (never hashing the yaml itself),
 * and ends on the matching `settled` outcome. A task whose spec is a refusal
 * ends on that outcome instead, without submitting.
 *
 * `milestones` overrides how many milestone numbers the stub stamps onto the
 * steps; it defaults to the task's own {@link FlowWorkerTask.milestoneCount},
 * which is what the engine's pre-flight demands a scenario realize.
 */
export function submitWorkerSessions(
  specFor: (task: FlowWorkerTask) => WorkerSpec | undefined,
  opts: {
    milestones?: (task: FlowWorkerTask) => number
    judge?: WorkerFidelityJudge
    onSubmit?: (task: FlowWorkerTask, report: { content: string; isError?: boolean }) => void
    /**
     * What the stub does when the engine REFUSES the submission (a fidelity
     * flag, a mispredicted red). `'fail'` (the default) reports a failed
     * session; `'retire'` ends on the `retired` outcome — which is what the
     * worker prompt tells a session to do when it cannot produce a faithful
     * scenario, and the arm a rejection test wants to exercise.
     */
    onRefusal?: 'fail' | 'retire'
    /** Capture the briefing the engine renders for each task (`task.prepare()`)
     *  — the worker path's stand-in for the retired author-prompt context. */
    onBriefing?: (task: FlowWorkerTask, briefing: string) => void
    summary?: Partial<GuardSessionSummary>
    /** The tally the seam reports for the depth-1 fidelity CHILDREN. */
    fidelitySummary?: GuardSessionSummary
  } = {},
): FlowWorkerSessionSeam {
  const refused = (reason: string): FlowWorkerSessionResult =>
    opts.onRefusal === 'retire'
      ? { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: reason } }
      : { kind: 'failed', reason }
  return flowWorkerSessionOf(async (task) => {
    const spec = specFor(task)
    if (!spec) return undefined
    // A real session ALWAYS opens on the engine's briefing (that is what
    // captures the cli ground probes), so the stub prepares one too.
    const briefing = await task.prepare()
    opts.onBriefing?.(task, briefing)
    if ('blocked' in spec) return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: spec.blocked } }
    if ('journeyDefect' in spec) return { kind: 'outcome', outcome: { kind: 'journey-defect', report: spec.journeyDefect } }
    if ('retired' in spec) return { kind: 'outcome', outcome: { kind: 'retired', ...spec.retired } }
    const judge = opts.judge ?? faithfulJudge
    if ('red' in spec) {
      const yamlText = scenarioYaml(stampMilestones(spec.red, opts.milestones?.(task) ?? task.milestoneCount))
      // Round 1 observes the failure; round 2 declares it, as the gate requires.
      const probe = await task.submitScenario(yamlText, [], judge)
      const expectedReds: GuardExpectedRed[] = [
        {
          step: observedStep(probe),
          predictedActual: observedActual(probe),
          verdict: spec.verdict ?? 'code-drift',
          brief: spec.brief ?? 'the doc and the code disagree',
        },
      ]
      const report = await task.submitScenario(yamlText, expectedReds, judge)
      opts.onSubmit?.(task, report)
      const sha = acceptedSha(report)
      if (sha === null) return refused(`the red submission was not accepted: ${report.content}`)
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds } }
    }
    const raw = 'scenario' in spec ? spec.scenario : spec
    const expectedReds = 'expectedReds' in spec ? spec.expectedReds : []
    const yamlText = scenarioYaml(stampMilestones(raw, opts.milestones?.(task) ?? task.milestoneCount))
    const report = await task.submitScenario(yamlText, expectedReds, judge)
    opts.onSubmit?.(task, report)
    const sha = acceptedSha(report)
    if (sha === null) return refused(`the submission was not accepted: ${report.content}`)
    return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds } }
  }, {
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(opts.fidelitySummary ? { fidelitySummary: opts.fidelitySummary } : {}),
  })
}

// ---------------------------------------------------------------------------
// Realization matching
// ---------------------------------------------------------------------------

/** A matcher that walks every milestone through the surface's FIRST interface. */
export function matchAll(onCall?: (flowId: string, surface: string) => void): MatchRunner {
  return async ({ flow, milestones, interfaces, surface }) => {
    onCall?.(flow.id, surface)
    return { plan: milestones.map((m) => ({ interfaceId: interfaces[0].id, milestone: m.order })) }
  }
}

/** A matcher that refuses the named flows (id → reason) and plans the rest. */
export function matchBy(unrealizable: Record<string, string>, onCall?: (flowId: string) => void): MatchRunner {
  return async (ctx) => {
    onCall?.(ctx.flow.id)
    const reason = unrealizable[ctx.flow.id]
    if (reason) return { unrealizable: reason }
    return { plan: ctx.milestones.map((m) => ({ interfaceId: ctx.interfaces[0].id, milestone: m.order })) }
  }
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/**
 * Stamp `milestone` onto a scenario's steps so it realizes all `count` milestones —
 * what a well-behaved author does. Steps that already carry one are left alone; a
 * scenario with fewer steps than milestones repeats its last step (a milestone is
 * realized by one step, so covering N milestones needs N steps).
 */
export function stampMilestones(scenario: RawGeneratedScenario, count: number): RawGeneratedScenario {
  if (scenario.steps.some((s) => typeof s.milestone === 'number')) return scenario
  const steps = [...scenario.steps]
  while (steps.length < count) steps.push({ ...steps[steps.length - 1] })
  return {
    ...scenario,
    steps: steps.map((s, i) => ({ ...s, milestone: Math.min(i + 1, count) })),
  } as RawGeneratedScenario
}

/** The yaml a worker session submits — a raw scenario, dumped the way the
 *  engine's own `serializeScenarioYaml` dumps one. */
export function scenarioYaml(scenario: RawGeneratedScenario): string {
  return yaml.dump(scenario, { lineWidth: -1, noRefs: true })
}

/** The sha the engine stashes an accepted submission under. */
export function yamlSha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A fidelity judge that reviews every candidate faithful. */
export const faithfulJudge: WorkerFidelityJudge = async () => ({ kind: 'faithful' })

/**
 * A fidelity judge that FLAGS any candidate whose title is a key of `flagged`
 * (its value is the mismatch, or `{ mismatch, confidence }` — a HIGH confidence
 * on the FIRST flag drives the in-loop self-heal), judging everything else
 * faithful. Reads the title out of the briefing the engine renders, which
 * carries the candidate's yaml. `onCall` fires once per review.
 */
export function judgeBy(
  flagged: Record<string, string | { mismatch: string; confidence?: 'high' | 'medium' | 'low' }>,
  onCall?: () => void,
): WorkerFidelityJudge {
  return async ({ briefing }) => {
    onCall?.()
    for (const [title, spec] of Object.entries(flagged)) {
      if (!briefing.includes(`title: ${title}`)) continue
      const mismatch = typeof spec === 'string' ? spec : spec.mismatch
      const confidence = typeof spec === 'string' ? 'medium' : (spec.confidence ?? 'medium')
      return { kind: 'flagged', mismatch, confidence }
    }
    return { kind: 'faithful' }
  }
}

// ---------------------------------------------------------------------------
// The pipeline, with flow-world defaults
// ---------------------------------------------------------------------------

/**
 * `generateGuards` with the defaults a flow-world test needs — the fixture cli
 * interface catalog, one atomic flow per claim, no epics, a matcher that walks
 * every milestone through the first interface, and a worker seam that refuses to
 * run. Any option overrides its default, so a test states only the stage it is
 * about. There is no production fallback any more: the four session seams are
 * REQUIRED fields, so a test that omits one does not compile.
 */
export function runGenerate(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  return generateGuards({ ...flowStageSeams(options.repoRoot), ...options })
}

/**
 * The interface + synthesis + matching seams a test must inject when it drives
 * the pipeline without a transport — the deterministic stand-ins
 * {@link runGenerate} applies, exposed for callers (the CLI driver tests) that
 * build their own options.
 */
export function flowStageSeams(repo: string): {
  interfaces: InterfaceProvider
  extractSession: ExtractSessionSeam
  flowsAreaSession: FlowsAreaSessionSeam
  flowsEpicSession: FlowsEpicSessionSeam
  flowWorkerSession: FlowWorkerSessionSeam
  matchRunner: MatchRunner
} {
  return {
    interfaces: DEFAULT_INTERFACES(repo),
    extractSession: extractSessionBy({}),
    flowsAreaSession: flowPerClaimSession(),
    flowsEpicSession: noEpicSessions,
    flowWorkerSession: noWorkerSessions,
    matchRunner: matchAll(),
  }
}

/** Write a full committed scenario file (YAML) — for hand-written / ownership tests. */
export function writeScenarioFile(repo: string, rel: string, scenario: GuardScenario): void {
  const target = path.join(repo, '.truecourse', 'scenarios', rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(scenario, null, 2))
}

// --- Api-driver fixtures ----------------------------------------------------

/** The fixture HTTP API (`todos`) shared with the guard-runner api tests. */
export const FIXTURE_API_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-api/server.mjs', import.meta.url),
)

/** The SECOND fixture HTTP API (`api-v2`) — the multi-server recipe fixture. */
export const FIXTURE_API_SERVER_V2 = fileURLToPath(
  new URL('../fixtures/guard-fixture-api/server-v2.mjs', import.meta.url),
)

/** Write a `recipe.json` with an `api` block booting the fixture todos server
 *  (and, unless `entry: null`, the fixture CLI entry so cli flows stay authorable). */
export function writeApiRecipe(
  repo: string,
  overrides: {
    build?: string
    entry?: string[] | null
    /** Single-server serve argv override; defaults to the fixture todos server. */
    serve?: string[]
    credentials?: Record<
      string,
      {
        header: string
        value?: string
        valueFromEnv?: string
        description?: string
        satisfies?: string
        /** The servers this credential authenticates against; absent ⇒ all. */
        servers?: string[]
      }
    >
    /** `api.externals` — user-provided external API accounts. */
    externals?: Record<string, unknown>
    /**
     * `api.servers` + `api.defaultServer` — the MULTI-server shape. Set it
     * and the single-server `serve`/`healthPath` fields are dropped (the schema
     * refuses them beside `servers`); leave it and every existing caller writes the
     * exact recipe it always did.
     */
    servers?: Record<string, Record<string, unknown>>
    defaultServer?: string
  } = {},
): void {
  const single = overrides.servers === undefined
  const recipe = {
    build: overrides.build ?? 'true',
    ...(overrides.entry === null ? {} : { entry: overrides.entry ?? ['node', FIXTURE_BIN] }),
    api: {
      ...(single
        ? { serve: overrides.serve ?? ['node', FIXTURE_API_SERVER], healthPath: '/health' }
        : {
            servers: overrides.servers,
            ...(overrides.defaultServer ? { defaultServer: overrides.defaultServer } : {}),
          }),
      ...(overrides.credentials ? { credentials: overrides.credentials } : {}),
      ...(overrides.externals ? { externals: overrides.externals } : {}),
    },
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
}

/** A raw generated api scenario as a model would return it. */
export function rawApi(
  title: string,
  steps: RawGeneratedApiScenario['steps'],
  extra: Partial<RawGeneratedScenario> = {},
): RawGeneratedScenario {
  return { title, steps, ...extra } as RawGeneratedScenario
}

/** An api step listing the fixture's empty todos (passes against the fixture). */
export const PASSING_API_STEPS: RawGeneratedApiScenario['steps'] = [
  { request: { method: 'GET', path: '/todos' }, expect: { status: 200, json: { todos: { equals: [] } } } },
]
/** An api step asserting /boom answers 200 (the fixture answers 500 → fails). */
export const FAILING_API_STEPS: RawGeneratedApiScenario['steps'] = [
  { request: { method: 'GET', path: '/boom' }, expect: { status: 200 } },
]
