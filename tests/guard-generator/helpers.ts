import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  interfaceFingerprint,
  type ApiRequestContract,
  type DetectedExternalService,
  type OutboundRequest,
  type GuardScenario,
  type Interface,
} from '@truecourse/shared'
import {
  generateGuards,
  type AuthorUserContext,
  type ExtractRunner,
  type FidelityRunner,
  type FlowsEpicRunner,
  type FlowsRunner,
  type GenerateGuardsOptions,
  type GenerateRunner,
  type GuardGenerateResult,
  type InterfaceProvider,
  type MatchRunner,
  type RawGeneratedScenario,
  type SeedDraftDatabase,
  type TriageRunner,
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
    JSON.stringify({ version: 1, generatedAt: '2026-01-01T00:00:00Z', recipeFingerprint: '', interfaces }, null, 2),
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
  return async () => ({ ...(await provider()), ...grounding })
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

/** What an {@link authorBy} entry may say about one flow. */
export type AuthorSpec =
  | RawGeneratedScenario
  | { blockedOn: string[] }
  | { retry: RawGeneratedScenario; first: RawGeneratedScenario }

/**
 * An author runner keyed by FLOW id: each flow's scenario, its `blockedOn` refusal,
 * or a `{ first, retry }` pair (round 1 vs the evidence re-author). A flow absent
 * from the map authors a passing scenario titled after it. Milestones are stamped
 * automatically unless the scenario already carries them.
 */
export function authorBy(
  byFlow: Record<string, AuthorSpec>,
  onCall?: (ctx: AuthorUserContext) => void,
): GenerateRunner {
  return async (ctx) => {
    onCall?.(ctx)
    const spec = byFlow[ctx.flow.id]
    const n = ctx.milestones.length
    if (!spec) return { scenario: stampMilestones(raw(ctx.flow.title, PASSING_STEPS), n) }
    if ('blockedOn' in spec) return spec
    if ('retry' in spec) {
      return { scenario: stampMilestones(ctx.retry ? spec.retry : spec.first, n) }
    }
    return { scenario: stampMilestones(spec, n) }
  }
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
 * interface catalog, one atomic flow per claim, no epics, a matcher that walks every
 * milestone through the first interface, and neutral stand-ins for the two
 * adjudication stages. Any option overrides its default, so a test states only the
 * stage it is about; passing `undefined` for one takes the production path, where
 * the engine spawns that runner on the transport.
 */
export function runGenerate(options: GenerateGuardsOptions): Promise<GuardGenerateResult> {
  return generateGuards({
    ...flowStageRunners(options.repoRoot),
    generateRunner: authorBy({}),
    ...stubAdjudicationRunners(),
    ...options,
  })
}

/**
 * Neutral stand-ins for the fidelity reviewer and the triage judge. The engine
 * spawns BOTH from the transport when neither is injected (the production path), so
 * a test that supplies neither would spawn the real `claude` and die on the
 * setup.ts binary tripwire. These keep a test that is not about them silent, at the
 * behaviour it would have had anyway: every green scenario reviews faithful, and a
 * triage call that cannot complete ships its failing test untriaged.
 */
export function stubAdjudicationRunners(): { fidelityRunner: FidelityRunner; triageRunner: TriageRunner } {
  return {
    fidelityRunner: async () => ({ verdict: 'faithful' }),
    triageRunner: async () => {
      throw new Error('triage stubbed off')
    },
  }
}

/**
 * The interface + synthesis + matching seams a test must inject when it drives the
 * pipeline without a transport — the deterministic stand-ins {@link runGenerate}
 * applies, exposed for callers (the CLI driver tests) that build their own options.
 */
export function flowStageRunners(repo: string): {
  interfaces: InterfaceProvider
  flowsRunner: FlowsRunner
  flowsEpicRunner: FlowsEpicRunner
  matchRunner: MatchRunner
} {
  return {
    interfaces: DEFAULT_INTERFACES(repo),
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
