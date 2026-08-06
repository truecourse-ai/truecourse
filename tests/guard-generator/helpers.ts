import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  journeyFingerprint,
  type ApiRequestContract,
  type DetectedExternalService,
  type OutboundRequest,
  type GuardScenario,
  type Journey,
} from '@truecourse/shared'
import {
  generateGuards,
  WORKER_API_SYSTEM_PROMPT,
  type ExtractRunner,
  type FidelityRunner,
  type FlowsEpicRunner,
  type FlowsRunner,
  type GenerateGuardsOptions,
  type GuardGenerateResult,
  type JourneyProvider,
  type MatchRunner,
  type RawGeneratedScenario,
  type SeedDraftDatabase,
} from '@truecourse/guard-generator'
import type { GuardTriage } from '@truecourse/shared'
import type { LlmTurnFn, LlmTurnReply, LlmTurnRequest } from '@truecourse/shared/llm'

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
  overrides: { install?: string; build?: string; entry?: string[] } = {},
): void {
  const recipe = {
    ...(overrides.install ? { install: overrides.install } : {}),
    build: overrides.build ?? 'true',
    entry: overrides.entry ?? ['node', FIXTURE_BIN],
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

/** A raw generated scenario as a model would return it (behavioral fields only). */
export function raw(
  title: string,
  steps: RawGeneratedScenario['steps'],
  extra: Partial<RawGeneratedScenario> = {},
): RawGeneratedScenario {
  return { title, driver: 'cli', steps, ...extra }
}

/** A scenario running `--version` and expecting exit 0 (passes against relkit). */
export const PASSING_STEPS: RawGeneratedScenario['steps'] = [{ run: ['--version'], expect: { exit: 0 } }]
/** A scenario running `boom` but expecting exit 0 (relkit exits 7 → fails). */
export const FAILING_STEPS: RawGeneratedScenario['steps'] = [{ run: ['boom'], expect: { exit: 0 } }]

// ---------------------------------------------------------------------------
// Journeys (the code half)
// ---------------------------------------------------------------------------

/** One cli journey over a command path — the shape the mapper derives. */
export function cliJourney(command: string[], flags: string[] = []): Journey {
  const shape = {
    type: 'cli' as const,
    entry: { command },
    steps: [{ kind: 'invoke' as const, command, flags }],
  }
  return {
    id: `cli/${command.join('-') || 'root'}`,
    title: command.join(' '),
    ...shape,
    fingerprint: journeyFingerprint(shape),
  }
}

/** One api journey over an operation — the shape the api mapper derives. */
export function apiJourney(method: string, apiPath: string): Journey {
  const shape = {
    type: 'api' as const,
    entry: { method, path: apiPath },
    steps: [{ kind: 'request' as const, method, path: apiPath }],
  }
  return {
    id: `api/${method.toLowerCase()}${apiPath.replace(/\W+/g, '-')}`,
    title: `${method} ${apiPath}`,
    ...shape,
    fingerprint: journeyFingerprint(shape),
  }
}

/**
 * Write the journey snapshot production's mapper writes (`guard/journeys.json`) —
 * the file the pre-flight estimate reads to know what the surfaces look like.
 */
export function writeJourneySnapshot(repo: string, journeys: Journey[]): void {
  const target = path.join(repo, '.truecourse', 'guard', 'journeys.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({ version: 1, generatedAt: '2026-01-01T00:00:00Z', recipeFingerprint: '', journeys }, null, 2),
  )
}

/** A journey provider over an explicit catalog, snapshotting it exactly as the
 *  real (analyzer-backed) mapper does so the estimate sees the same surfaces. */
export function journeysOf(repo: string, ...journeys: Journey[]): JourneyProvider {
  return async () => {
    writeJourneySnapshot(repo, journeys)
    return { journeys }
  }
}

/**
 * The same catalog, plus the third parties a detector would have found —
 * both ride ONE provider in production because both come from one analysis pass.
 */
export function withExternalServices(
  provider: JourneyProvider,
  ...services: {
    service: string
    category?: DetectedExternalService['category']
    /** The base-URL env var the detector saw, when it saw one. */
    baseUrlEnv?: string
    /** Every override variable the detector saw, best-confidence first. */
    baseUrlEnvs?: DetectedExternalService['baseUrlEnvs']
    source?: DetectedExternalService['source']
  }[]
): JourneyProvider {
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
  provider: JourneyProvider,
  grounding: { requestContracts?: ApiRequestContract[]; outboundRequests?: OutboundRequest[] },
): JourneyProvider {
  return async () => ({ ...(await provider()), ...grounding })
}

/**
 * The same catalog, plus the datastore + parsed schema the analyzer would have
 * found — one provider, because production derives both from one pass.
 */
export function withDatabase(provider: JourneyProvider, database: SeedDraftDatabase | null): JourneyProvider {
  return async () => ({ ...(await provider()), database })
}

/** The default catalog: the fixture CLI's two commands. */
export const DEFAULT_JOURNEYS = (repo: string): JourneyProvider =>
  journeysOf(repo, cliJourney(['relkit']), cliJourney(['relkit', 'boom']))

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** How a section's claims are described in an {@link extractBy} spec. */
export type ClaimSpec =
  | Array<{ claim?: string; driver?: 'cli' | 'api' | 'web' | 'tui' | 'library'; reason?: string }>
  | { untestable: string }

/**
 * An extract runner driven by a per-anchor claim map. The runner reads the
 * document outline it is given and, for each section present in the map, returns
 * either its claims or an untestable note. Sections absent from the map yield a
 * single default cli claim (so "everything testable" is the default). Anchors not
 * in the outline are ignored.
 */
export function extractBy(byAnchor: Record<string, ClaimSpec>, onCall?: () => void): ExtractRunner {
  return async ({ outline }) => {
    onCall?.()
    const claims: { claim: string; driver: string; sectionAnchor: string; reason: string }[] = []
    const untestable: { sectionAnchor: string; reason: string }[] = []
    for (const entry of outline) {
      const spec = byAnchor[entry.anchor] ?? [{}]
      if (Array.isArray(spec)) {
        for (const c of spec) {
          claims.push({
            claim: c.claim ?? `${entry.anchor} claim`,
            driver: c.driver ?? 'cli',
            sectionAnchor: entry.anchor,
            reason: c.reason ?? 'exit code is observable',
          })
        }
      } else {
        untestable.push({ sectionAnchor: entry.anchor, reason: spec.untestable })
      }
    }
    return { claims, untestable }
  }
}

// ---------------------------------------------------------------------------
// Flow synthesis
// ---------------------------------------------------------------------------

/**
 * Flow synthesis fake: ONE atomic flow per claim, titled from the claim's anchor —
 * so a flow's id IS the anchor slug and its scenarios read `<anchor>.<surface>.<n>`.
 * The default for tests that care about a claim, not a composition.
 */
export function flowPerClaim(onCall?: (areaId: string) => void): FlowsRunner {
  return async ({ areaId, claims }) => {
    onCall?.(areaId)
    return {
      flows: claims.map((c) => ({
        title: c.anchor,
        goal: `verify ${c.claim}`,
        milestones: [{ order: 1, doc: c.doc, anchor: c.anchor, claimTitle: c.claim }],
      })),
      noFlowClaims: [],
    }
  }
}

/** Flow synthesis fake: ONE composite flow chaining every claim of the area, in the
 *  order the claims were given — the multi-milestone path. */
export function flowOfAll(title: string, onCall?: (areaId: string) => void): FlowsRunner {
  return async ({ areaId, claims }) => {
    onCall?.(areaId)
    if (claims.length === 0) return { flows: [], noFlowClaims: [] }
    return {
      flows: [
        {
          title,
          goal: `walk ${claims.length} milestone(s)`,
          milestones: claims.map((c, i) => ({ order: i + 1, doc: c.doc, anchor: c.anchor, claimTitle: c.claim })),
        },
      ],
      noFlowClaims: [],
    }
  }
}

/** An epic pass that never chains anything (the default answer). */
export const noEpics: FlowsEpicRunner = async () => ({ epics: [] })

// ---------------------------------------------------------------------------
// Realization matching
// ---------------------------------------------------------------------------

/** A matcher that walks every milestone through the surface's FIRST journey. */
export function matchAll(onCall?: (flowId: string, surface: string) => void): MatchRunner {
  return async ({ flow, milestones, journeys, surface }) => {
    onCall?.(flow.id, surface)
    return { plan: milestones.map((m) => ({ journeyId: journeys[0].id, milestone: m.order })) }
  }
}

/** A matcher that refuses the named flows (id → reason) and plans the rest. */
export function matchBy(unrealizable: Record<string, string>, onCall?: (flowId: string) => void): MatchRunner {
  return async (ctx) => {
    onCall?.(ctx.flow.id)
    const reason = unrealizable[ctx.flow.id]
    if (reason) return { unrealizable: reason }
    return { plan: ctx.milestones.map((m) => ({ journeyId: ctx.journeys[0].id, milestone: m.order })) }
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

// ---------------------------------------------------------------------------
// The worker turn seam (cli + api authoring)
// ---------------------------------------------------------------------------

/** What a {@link workerTurnBy} entry may say about one flow's worker session. */
export type WorkerSpec =
  | RawGeneratedScenario
  | { blockedOn: string[]; blockedMilestones?: { milestone: number; blockedOn: string[] }[] }
  | { first: RawGeneratedScenario; retry: RawGeneratedScenario }
  | { scenario: RawGeneratedScenario; failing: GuardTriage }
  | { journeyDefect: { argv?: string[]; promised: string; observed: string } }
  | { throws: string }
  | { malformed: true }

/** One fenced-action reply, the shape the loop's text protocol parses. */
export function turnReply(actionValue: unknown): LlmTurnReply {
  return {
    text: '```json\n' + JSON.stringify(actionValue) + '\n```',
    usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.01 },
  }
}

/** The worker's canned failing diagnosis (the triage wire shape). */
export const WORKER_FAILING: GuardTriage = {
  verdict: 'code-drift',
  confidence: 'high',
  brief: 'The program disagrees with the claim.',
  recommendation: 'Align the code with the doc, or fix the doc.',
}

/**
 * A scripted worker TURN FN over per-surface flow maps (the session's `subject`
 * is the flow id; the surface is read off the session's system prompt). Each
 * flow's spec drives a canonical session: run the scenario once, read the
 * capture, and settle by its verdict (passing, or FAILING with the canned
 * {@link WORKER_FAILING} diagnosis). A flow absent from its surface's map
 * authors a passing scenario titled after it (parsed from the prompt's own FLOW
 * line) — cli scenarios over {@link PASSING_STEPS}, api ones over
 * {@link PASSING_API_STEPS}. Milestones are stamped automatically. A RESUME
 * observation (a fidelity flag, a confirmation flip) re-runs the flow's scenario
 * (the `retry` half of a pair, when one is given) and settles by the fresh
 * verdict.
 */
export function workerTurnsBy(
  maps: { cli?: Record<string, WorkerSpec>; api?: Record<string, WorkerSpec> },
  onTurn?: (req: LlmTurnRequest) => void,
): LlmTurnFn {
  return async (req) => {
    onTurn?.(req)
    const surface = req.system.startsWith(WORKER_API_SYSTEM_PROMPT) ? 'api' : 'cli'
    const flowId = req.subject ?? ''
    const spec = maps[surface]?.[flowId]
    if (spec && 'throws' in spec) throw new Error(spec.throws)
    if (spec && 'malformed' in spec) return { text: 'no action block here' }
    if (spec && 'journeyDefect' in spec) {
      return turnReply({ outcome: { result: 'journey-defect', ...spec.journeyDefect } })
    }
    if (spec && 'blockedOn' in spec) {
      return turnReply({
        outcome: {
          result: 'blocked',
          blockedOn: spec.blockedOn,
          ...(spec.blockedMilestones ? { blockedMilestones: spec.blockedMilestones } : {}),
        },
      })
    }
    // The opening prompt carries the flow context: title + milestone count.
    const opening = req.messages[0]?.text ?? ''
    const n = parseInt(/^milestones: (\d+)$/m.exec(opening)?.[1] ?? '1', 10)
    const title = /^FLOW: (.+)$/m.exec(opening)?.[1] ?? flowId
    const ranBefore = req.messages.filter(
      (m) => m.role === 'user' && m.text.startsWith('run_scenario result:'),
    ).length
    const scenarioOf = (): RawGeneratedScenario => {
      if (!spec) {
        return stampMilestones(
          surface === 'api' ? rawApi(title, PASSING_API_STEPS) : raw(title, PASSING_STEPS),
          n,
        )
      }
      if ('first' in spec) return stampMilestones(ranBefore === 0 ? spec.first : spec.retry, n)
      if ('scenario' in spec) return stampMilestones(spec.scenario, n)
      return stampMilestones(spec, n)
    }
    const last = req.messages[req.messages.length - 1]
    const lastText = last?.text ?? ''
    if (lastText.includes('Tool error:')) {
      // The sandbox refused the run (a run-level refusal) — give up so the
      // session ends `malformed` instead of burning the whole turn budget.
      return { text: 'giving up: the sandbox refused to run the scenario' }
    }
    if (last?.role === 'user' && lastText.startsWith('run_scenario result:')) {
      // The capture came back: converge (a `first/retry` pair revises once), or
      // settle by the verdict — a failing run settles FAILING with a diagnosis.
      if (lastText.includes('"verdict": "pass"')) {
        return turnReply({ outcome: { result: 'settled' } })
      }
      if (spec && 'first' in spec && ranBefore === 1) {
        return turnReply({ tool: 'run_scenario', args: { scenario: scenarioOf() } })
      }
      if (spec && 'scenario' in spec) {
        return turnReply({ outcome: { result: 'settled', failing: spec.failing } })
      }
      return turnReply({ outcome: { result: 'settled', failing: WORKER_FAILING } })
    }
    // The opening prompt, a resume observation, or a re-ask: run the scenario.
    return turnReply({ tool: 'run_scenario', args: { scenario: scenarioOf() } })
  }
}

/** {@link workerTurnsBy} with only a CLI map — the shape most cli-flow tests use. */
export function workerTurnBy(
  byFlow: Record<string, WorkerSpec>,
  onTurn?: (req: LlmTurnRequest) => void,
): LlmTurnFn {
  return workerTurnsBy({ cli: byFlow }, onTurn)
}

/** {@link workerTurnsBy} with only an API map — the api-flow analog. */
export function apiWorkerTurnBy(
  byFlow: Record<string, WorkerSpec>,
  onTurn?: (req: LlmTurnRequest) => void,
): LlmTurnFn {
  return workerTurnsBy({ api: byFlow }, onTurn)
}

/** A fidelity reviewer that judges every green scenario faithful (persist). */
export function faithfulReviewer(onCall?: () => void): FidelityRunner {
  return async () => {
    onCall?.()
    return { verdict: 'faithful' }
  }
}

/**
 * A fidelity reviewer that FLAGS any scenario whose title is a key of `flagged`
 * (its value is the mismatch, or `{ mismatch, confidence }` — a HIGH confidence
 * drives the self-heal), judging everything else faithful. Reads the scenario
 * title out of the YAML it is handed. `onCall` fires once per review.
 */
export function reviewBy(
  flagged: Record<string, string | { mismatch: string; confidence?: 'high' | 'medium' | 'low' }>,
  onCall?: () => void,
): FidelityRunner {
  return async ({ scenarioYaml }) => {
    onCall?.()
    for (const [title, spec] of Object.entries(flagged)) {
      if (!scenarioYaml.includes(`title: ${title}`)) continue
      return typeof spec === 'string' ? { verdict: 'flagged', mismatch: spec } : { verdict: 'flagged', ...spec }
    }
    return { verdict: 'faithful' }
  }
}

// ---------------------------------------------------------------------------
// The pipeline, with flow-world defaults
// ---------------------------------------------------------------------------

/**
 * `generateGuards` with the defaults a flow-world test needs — the fixture cli
 * journey catalog, one atomic flow per claim, no epics, a matcher that walks every
 * milestone through the first journey, and neutral stand-ins for the two
 * adjudication stages. Any option overrides its default, so a test states only the
 * stage it is about; passing `undefined` for one takes the production path, where
 * the engine spawns that runner on the transport.
 */
export function runGenerate(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  return generateGuards({
    ...flowStageRunners(options.repoRoot),
    turnFn: workerTurnsBy({}),
    ...stubAdjudicationRunners(),
    ...options,
  })
}

/**
 * A neutral stand-in for the fidelity reviewer. The engine spawns it from the
 * transport when none is injected (the production path), so a test that supplies
 * none would spawn the real `claude` and die on the setup.ts binary tripwire.
 * This keeps a test that is not about it silent, at the behaviour it would have
 * had anyway: every green scenario reviews faithful.
 */
export function stubAdjudicationRunners(): { fidelityRunner: FidelityRunner } {
  return {
    fidelityRunner: async () => ({ verdict: 'faithful' }),
  }
}

/**
 * The journey + synthesis + matching seams a test must inject when it drives the
 * pipeline without a transport — the deterministic stand-ins {@link runGenerate}
 * applies, exposed for callers (the CLI driver tests) that build their own options.
 */
export function flowStageRunners(repo: string): {
  journeys: JourneyProvider
  flowsRunner: FlowsRunner
  flowsEpicRunner: FlowsEpicRunner
  matchRunner: MatchRunner
} {
  return {
    journeys: DEFAULT_JOURNEYS(repo),
    flowsRunner: flowPerClaim(),
    flowsEpicRunner: noEpics,
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
  steps: Extract<RawGeneratedScenario, { driver: 'api' }>['steps'],
  extra: Partial<RawGeneratedScenario> = {},
): RawGeneratedScenario {
  return { title, driver: 'api', steps, ...extra } as RawGeneratedScenario
}

/** An api step listing the fixture's empty todos (passes against the fixture). */
export const PASSING_API_STEPS: Extract<RawGeneratedScenario, { driver: 'api' }>['steps'] = [
  { request: { method: 'GET', path: '/todos' }, expect: { status: 200, json: { todos: { equals: [] } } } },
]
/** An api step asserting /boom answers 200 (the fixture answers 500 → fails). */
export const FAILING_API_STEPS: Extract<RawGeneratedScenario, { driver: 'api' }>['steps'] = [
  { request: { method: 'GET', path: '/boom' }, expect: { status: 200 } },
]
