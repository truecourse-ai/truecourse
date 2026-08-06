/**
 * JOURNEY SELF-HEAL — the in-run verification of a worker's `journey-defect`
 * ending. A worker that observes the sandbox contradicting its given grammar
 * reports the defect and stops; the engine then asks THIS seam to verify the
 * dispute against the live program and resumes the same session once with the
 * verdict — the corrected grammar when the worker was right, the confirmation
 * when it was wrong — so the flow completes in-run instead of stranding until
 * the mapper is fixed. The defect report itself is still recorded either way:
 * it is the journey-mapper's feedback loop, and the heal never mutes it.
 *
 * The seam is surface-agnostic: one {@link JourneyHealProbe} per surface over a
 * shared verdict vocabulary; the engine-side flow (one heal per task, the
 * resume, the report entry, the terminal on a second defect) is shared code.
 * Only probe construction and the corrected-grammar rendering differ:
 *  - cli — re-run the disputed command's `--help` in a fresh sandbox (the same
 *    executor grounding probes use), parse it with the journey-mapper's own
 *    help parser, and UNION the observed facts into the journey grammar
 *    (`unionCliSurfaces` semantics: the probe fills and overrides option facts;
 *    the fingerprinted `flags` set never moves). A correction patches the
 *    plan's journeys in place and rewrites `guard/journeys.json` with the
 *    heal's diagnostics.
 *  - api — boot the BOUND server once (the runner's own preflight boot, the
 *    endpoint-probe path) and request the disputed operation. A 404, or a 405
 *    where the promised method itself was sent, confirms the defect; there is
 *    no grammar to correct (`corrected` stays absent) — the confirmation is
 *    what the session resumes with, and the worker settles with a diagnosis.
 *    A destructive method is never sent for real: only GET/HEAD run as
 *    promised, anything else probes the path's existence with GET.
 */

import path from 'node:path'
import {
  atomicWriteJson,
  guardJourneysPath,
  preflightApiServer,
  readJourneyCatalog,
  resolveApiServers,
  resolveEntry,
  type Recipe,
  type StepCapture,
} from '@truecourse/guard-runner'
import {
  parseCliHelp,
  unionCliSurfaces,
  type CliTreeSurface,
  type ParsedCliHelp,
  type ProbedCliSurface,
} from '@truecourse/journey-mapper'
import type {
  Journey,
  JourneyCliOption,
  JourneyDiagnostic,
  JourneyInvokeStep,
  JourneysFile,
} from '@truecourse/shared'
import {
  defaultProbeExecutor,
  programNamesOf,
  repoPackageProgramNames,
  type ProbeExecutor,
} from './ground.js'
import { PROBE_REQUEST_TIMEOUT_MS } from './endpoint-probe.js'
import { renderCommandGrammarEntry } from './prompts.js'

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** The disputed grammar as the worker reported it — the probe's whole input. */
export interface JourneyHealDefect {
  /** The argv (cli) or request line (api) the worker named, when it named one. */
  argv?: string[]
  promised: string
  observed: string
}

/** A surface's corrected grammar, produced when the probe sided with the worker
 *  AND the surface has a grammar to correct. The adapter has already APPLIED the
 *  patch (the in-memory journeys, the `journeys.json` snapshot) by the time it
 *  returns — the engine only renders and resumes. */
export interface JourneyHealCorrection {
  /** One line for the report row (`corrected`). */
  summary: string
  /** The corrected-grammar lines the resume observation embeds. */
  rendered: string[]
}

/** What one live re-verification concluded about the dispute. */
export type JourneyHealVerdict =
  | { verdict: 'defect-confirmed'; observed: string; corrected?: JourneyHealCorrection }
  | { verdict: 'grammar-confirmed'; observed: string }
  | { verdict: 'probe-failed'; detail: string }

/** One surface's live re-verification of a disputed grammar/contract. */
export interface JourneyHealProbe {
  probe(defect: JourneyHealDefect): Promise<JourneyHealVerdict>
}

// ---------------------------------------------------------------------------
// cli adapter — the `--help` re-probe
// ---------------------------------------------------------------------------

export interface CliJourneyHealOptions {
  repoRoot: string
  /**
   * The task's bound journeys — the grammar under dispute. A correction patches
   * their invoke steps IN PLACE: plans and catalogs share the objects, so the
   * task's rebuilt COMMAND GRAMMAR and the run's journey catalog both see it.
   */
  journeys: readonly Journey[]
  /** The recipe entry resolved to spawnable argv. */
  resolvedEntry: readonly string[]
  /** The recipe entry as written — the program-name stripping source. */
  displayEntry: readonly string[]
  recipeEnv?: Record<string, string>
  /** Test seam; production uses the grounding probes' sandboxed executor. */
  exec?: ProbeExecutor
}

/** One disputed command: the journey that binds it and its invoke step. */
interface DisputedStep {
  journey: Journey
  step: JourneyInvokeStep
}

export function cliJourneyHealProbe(opts: CliJourneyHealOptions): JourneyHealProbe {
  return {
    async probe(defect) {
      const disputed = disputedInvokeSteps(opts.journeys, defect.argv)
      if (disputed.length === 0) {
        return { verdict: 'probe-failed', detail: 'the plan binds no cli command grammar to re-probe' }
      }
      const exec = opts.exec ?? defaultProbeExecutor
      const programNames = programNamesOf(opts.displayEntry, repoPackageProgramNames(opts.repoRoot))
      const failures: string[] = []
      const diagnostics: JourneyDiagnostic[] = []
      const patched: Journey[] = []
      let probed = 0
      for (const { journey, step } of disputed) {
        const argv = helpProbeArgv(step.command, programNames)
        let capture: StepCapture
        try {
          capture = await exec([...opts.resolvedEntry, ...argv], opts.recipeEnv)
        } catch (e) {
          failures.push(`\`${argv.join(' ')}\` failed to run: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        const text = `${capture.stdout}\n${capture.stderr}`.trim()
        if (capture.timedOut || capture.spawnError || !text) {
          failures.push(`\`${argv.join(' ')}\` produced no help output`)
          continue
        }
        const parsed = parseCliHelp(text)
        if (parsed.options.length === 0) {
          failures.push(`\`${argv.join(' ')}\` help output yielded no parseable option grammar`)
          continue
        }
        probed++
        const union = unionStepGrammar(step, parsed)
        if (union.diagnostics.length === 0) continue
        step.options = union.options
        diagnostics.push(...union.diagnostics)
        patched.push(journey)
      }
      if (probed === 0) {
        return { verdict: 'probe-failed', detail: failures[0] ?? 'no disputed command could be probed' }
      }
      if (diagnostics.length === 0) {
        return { verdict: 'grammar-confirmed', observed: 'The live --help output confirms the given command grammar.' }
      }
      patchJourneySnapshot(opts.repoRoot, patched, diagnostics)
      const more = diagnostics.length - 1
      return {
        verdict: 'defect-confirmed',
        observed: `The live --help disagrees with the given grammar: ${diagnostics[0].detail}.`,
        corrected: {
          summary: `${diagnostics[0].detail}${more > 0 ? ` (and ${more} more correction${more === 1 ? '' : 's'})` : ''}`,
          rendered: renderedCorrection(disputed, diagnostics),
        },
      }
    },
  }
}

/**
 * The disputed commands. With an argv: the LONGEST bound command path that
 * prefixes it (the tokens after the command are the worker's flags and values,
 * not command identity). Without one, or with an argv no bound command
 * prefixes, every bound command is disputed — the fallback the defect's own
 * vagueness earns.
 */
function disputedInvokeSteps(journeys: readonly Journey[], argv: readonly string[] | undefined): DisputedStep[] {
  const steps: DisputedStep[] = []
  const seen = new Set<string>()
  for (const journey of journeys) {
    if (journey.type !== 'cli') continue
    for (const step of journey.steps) {
      if (step.kind !== 'invoke') continue
      const key = step.command.join(' ')
      if (seen.has(key)) continue
      seen.add(key)
      steps.push({ journey, step })
    }
  }
  if (!argv || argv.length === 0) return steps
  const matches = steps
    .filter(({ step }) => step.command.length <= argv.length && step.command.every((t, i) => t === argv[i]))
    .sort((a, b) => b.step.command.length - a.step.command.length)
  return matches.length > 0 ? [matches[0]] : steps
}

/** The probe argv for one command: a leading program-name token stripped (the
 *  root journey's command IS the program name and strips to the bare `--help`),
 *  then `--help` appended. */
function helpProbeArgv(command: readonly string[], programNames: ReadonlySet<string>): string[] {
  const tokens = [...command]
  if (tokens.length > 0 && (programNames.has(tokens[0]) || programNames.has(path.basename(tokens[0])))) {
    tokens.shift()
  }
  return [...tokens, '--help']
}

/**
 * One command's tree-vs-probe union, through the journey-mapper's own merge
 * (`unionCliSurfaces`) over single-seed surfaces: the probe fills and overrides
 * option facts, the diagnostics name every disagreement, and the fingerprinted
 * `flags` list is never consulted for identity here — only `options` moves. A
 * help flag the probe alone documents is dropped again (journeys deliberately
 * model `--help` at the root only; the union admits it without a diagnostic).
 */
function unionStepGrammar(
  step: JourneyInvokeStep,
  parsed: ParsedCliHelp,
): { options: JourneyCliOption[]; diagnostics: JourneyDiagnostic[] } {
  const tree: CliTreeSurface = {
    seeds: [
      {
        path: [...step.command],
        flags: [...step.flags],
        ...(step.options ? { options: step.options.map((o) => ({ ...o })) } : {}),
      },
    ],
    root: null,
  }
  const probed: ProbedCliSurface = {
    root: { subcommands: [], flags: [], options: [] },
    seeds: [{ path: [...step.command], flags: [...parsed.flags], options: parsed.options.map((o) => ({ ...o })) }],
    probedCommands: new Set<string>(),
  }
  const { surface, diagnostics } = unionCliSurfaces(tree, probed)
  const merged = surface.seeds[0]
  const hadHelp = new Set(
    [...(step.options?.map((o) => o.flag) ?? []), ...step.flags].filter((f) => f === '--help' || f === '-h'),
  )
  const options = (merged.options ?? merged.flags.map((flag) => ({ flag }))).filter(
    (o) => !((o.flag === '--help' || o.flag === '-h') && !hadHelp.has(o.flag)),
  )
  return { options, diagnostics }
}

/** The corrected COMMAND GRAMMAR lines the resume observation embeds: every
 *  disputed command's entry (patched ones show the merged facts), plus one line
 *  naming the grammar flags the live help does NOT document. */
function renderedCorrection(disputed: readonly DisputedStep[], diagnostics: readonly JourneyDiagnostic[]): string[] {
  const lines: string[] = []
  for (const { step } of disputed) {
    lines.push(
      ...renderCommandGrammarEntry({
        command: [...step.command],
        ...(step.label ? { label: step.label } : {}),
        options: step.options ?? step.flags.map((flag) => ({ flag })),
      }),
    )
  }
  const undocumented = diagnostics.filter((d) => d.kind === 'probe-missing-flag')
  if (undocumented.length > 0) {
    const named = undocumented
      .map((d) => `\`${d.flag}\`${d.path.length > 0 ? ` (${d.path.join(' ')})` : ''}`)
      .join(', ')
    lines.push(`The live --help does not document: ${named}. Prefer the flags the live help documents.`)
  }
  return lines
}

/** Rewrite `guard/journeys.json` with the patched journeys plus the heal's
 *  diagnostics — the same atomic write the journey service uses. A repo with no
 *  snapshot (a degraded mapping) keeps its in-memory patch only. */
function patchJourneySnapshot(
  repoRoot: string,
  patched: readonly Journey[],
  diagnostics: readonly JourneyDiagnostic[],
): void {
  const snapshot = readJourneyCatalog(repoRoot)
  if (!snapshot) return
  const byId = new Map(patched.map((j) => [j.id, j]))
  const file: JourneysFile = {
    ...snapshot,
    journeys: snapshot.journeys.map((j) => byId.get(j.id) ?? j),
    diagnostics: [...(snapshot.diagnostics ?? []), ...diagnostics],
  }
  atomicWriteJson(guardJourneysPath(repoRoot), file)
}

// ---------------------------------------------------------------------------
// api adapter — the bound-server operation probe
// ---------------------------------------------------------------------------

export interface ApiJourneyHealOptions {
  repoRoot: string
  recipe: Recipe
  /** The bound server's name; absent means the recipe's default server. */
  server?: string
  /** The task's bound journeys — the operation-entry fallback when the defect
   *  itself does not name the disputed request. */
  journeys: readonly Journey[]
  /** Test seam; production uses `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i
const REQUEST_LINE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s`"'()[\],]*)/i

export function apiJourneyHealProbe(opts: ApiJourneyHealOptions): JourneyHealProbe {
  return {
    async probe(defect) {
      const operation = disputedOperation(defect, opts.journeys)
      if (!operation) return { verdict: 'probe-failed', detail: 'the defect names no operation to probe' }
      const resolved = resolveApiServers(opts.recipe)
      const server = resolved.servers.get(opts.server ?? resolved.defaultServer)
      if (!server) return { verdict: 'probe-failed', detail: 'the recipe declares no api server to boot' }
      // Only GET/HEAD are sent as promised; a method that could write probes the
      // PATH with GET instead — the structural question is route existence, and
      // the probe must never mutate the app under test.
      const promisedProbed = operation.method === 'GET' || operation.method === 'HEAD'
      const method = promisedProbed ? operation.method : 'GET'
      const requestPath = concretePath(operation.path)
      const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))
      let status: number | null = null
      let fetchError: string | null = null
      const boot = await preflightApiServer({
        resolvedServe: resolveEntry(opts.repoRoot, [...server.serve]),
        displayServe: server.serve,
        ...(server.cwd === 'repo' ? { cwd: opts.repoRoot } : {}),
        recipeEnv: server.env,
        healthPath: server.healthPath,
        readyTimeoutMs: server.readyTimeoutMs,
        onReady: async (baseUrl) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), PROBE_REQUEST_TIMEOUT_MS)
          try {
            const res = await doFetch(new URL(requestPath, baseUrl), { method, signal: controller.signal })
            status = res.status
          } catch (e) {
            fetchError = controller.signal.aborted
              ? `the request did not answer within ${PROBE_REQUEST_TIMEOUT_MS}ms`
              : e instanceof Error
                ? e.message
                : String(e)
          } finally {
            clearTimeout(timer)
          }
        },
      })
      if (!boot.ok) {
        return { verdict: 'probe-failed', detail: `the bound server did not boot: ${firstLine(boot.stderr)}` }
      }
      if (fetchError !== null || status === null) {
        return { verdict: 'probe-failed', detail: `the probe request failed: ${fetchError ?? 'no response'}` }
      }
      const subject = `${operation.method} ${operation.path}`
      const skipped = promisedProbed
        ? ''
        : ` (probed with GET; ${operation.method} was not sent because it could write)`
      if (status === 404 || (promisedProbed && status === 405)) {
        return {
          verdict: 'defect-confirmed',
          observed: promisedProbed
            ? `A fresh boot of the service answers ${status} for ${subject}.`
            : `A fresh boot of the service answers ${status} for the path ${requestPath}${skipped}.`,
        }
      }
      return {
        verdict: 'grammar-confirmed',
        observed: promisedProbed
          ? `A fresh boot of the service serves ${subject}: it answered ${status}.`
          : `A fresh boot of the service serves the path ${requestPath}: GET answered ${status}, so the route exists${skipped}.`,
      }
    },
  }
}

/** The disputed operation: the defect's argv (`["GET","/todos"]` or a bare
 *  path), a `METHOD /path` request line quoted in its prose, or the bound
 *  journeys' first operation entry. */
function disputedOperation(
  defect: JourneyHealDefect,
  journeys: readonly Journey[],
): { method: string; path: string } | null {
  const argv = defect.argv ?? []
  if (argv.length >= 2 && HTTP_METHOD.test(argv[0]) && argv[1].startsWith('/')) {
    return { method: argv[0].toUpperCase(), path: argv[1] }
  }
  if (argv.length === 1 && argv[0].startsWith('/')) return { method: 'GET', path: argv[0] }
  const quoted = REQUEST_LINE.exec(`${defect.promised}\n${defect.observed}`)
  if (quoted) return { method: quoted[1].toUpperCase(), path: quoted[2] }
  for (const journey of journeys) {
    if (journey.type !== 'api') continue
    if ('method' in journey.entry) {
      return { method: journey.entry.method.toUpperCase(), path: journey.entry.path }
    }
  }
  return null
}

/** A probe-able concrete path: template params become `1` — an existence probe
 *  needs a request the router will attempt to match, not a literal `{id}`. */
function concretePath(routePath: string): string {
  return routePath.replace(/\{[^}]+\}/g, '1')
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}
