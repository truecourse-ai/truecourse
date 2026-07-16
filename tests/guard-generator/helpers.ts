import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocSectionIndex, type GuardScenario } from '@truecourse/guard-runner'
import type {
  RawGeneratedScenario,
  GenerateRunner,
  ExtractRunner,
  FidelityRunner,
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
  return { doc: docRel, section: section.anchor, fingerprint: section.fingerprint }
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

/**
 * An author runner driven by a per-section-anchor scenario map: every claim in a
 * batch gets its section's scenarios (default: none). One call per batch (round 1)
 * or per claim (a retry); `onCall` fires once per invocation.
 */
export function authorBy(byAnchor: Record<string, RawGeneratedScenario[]>, onCall?: () => void): GenerateRunner {
  return async ({ claims }) => {
    onCall?.()
    return claims.map((c) => ({ ref: c.ref, scenarios: byAnchor[c.section.anchor] ?? [] }))
  }
}

/** A fidelity reviewer that judges every green scenario faithful (persist as today). */
export function faithfulReviewer(onCall?: () => void): FidelityRunner {
  return async () => {
    onCall?.()
    return { verdict: 'faithful' }
  }
}

/**
 * A fidelity reviewer that FLAGS any scenario whose title is a key of `flagged`
 * (its value is the mismatch), judging everything else faithful. Reads the scenario
 * title out of the YAML it is handed. `onCall` fires once per review.
 */
export function reviewBy(flagged: Record<string, string>, onCall?: () => void): FidelityRunner {
  return async ({ scenarioYaml }) => {
    onCall?.()
    for (const [title, mismatch] of Object.entries(flagged)) {
      if (scenarioYaml.includes(`title: ${title}`)) return { verdict: 'flagged', mismatch }
    }
    return { verdict: 'faithful' }
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

/** Write a `recipe.json` with an `api` block booting the fixture todos server
 *  (and, unless `entry: null`, the fixture CLI entry so cli claims stay authorable). */
export function writeApiRecipe(
  repo: string,
  overrides: { build?: string; entry?: string[] | null } = {},
): void {
  const recipe = {
    build: overrides.build ?? 'true',
    ...(overrides.entry === null ? {} : { entry: overrides.entry ?? ['node', FIXTURE_BIN] }),
    api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
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
