/**
 * INTERFACE RECONCILIATION — `guard-setup.reconcile-interfaces`: the ONE session per setup run that settles what the cli UNION could not.
 *
 * The deterministic union (`deriveCliInterfaces` in `@truecourse/interface-mapper`)
 * merges the tree derivation with the probe ladder and reports every
 * disagreement as a `MapperDiagnostic`. Observation can settle those disputes —
 * the program itself answers "does `add` take `--transport`" when you run it —
 * so ONE session takes the whole diagnostics list, runs the entry, and returns
 * a resolution per subject. ZERO diagnostics means ZERO sessions: the union
 * agreed with itself and there is nothing to ask.
 *
 * SANDBOX-ONLY, NO CODE ACCESS. The session's one tool is
 * `run_entry`: a fresh hermetic sandbox per call, spawning
 * `[...resolvedEntry, ...argv]` and returning exit + streams. It cannot read
 * the repo — the tree's claim and the probe's claim are already stated in the
 * briefing, and letting it re-read the source would just re-run the derivation
 * with worse tools. What observation cannot establish stays `unknown`, never
 * guessed.
 *
 * THE FOLD IS THE CALLER'S ({@link applyReconcileResolutions} is the pure half
 * of it): resolutions are applied to the IN-MEMORY catalog before the snapshot
 * write — facts only (drop a phantom flag, drop a phantom command; a kept fact
 * was already in the union), so the catalog stays deterministic and
 * fingerprintable and the diagnostics themselves never enter it. Wiring into
 * `runGuardSetup`'s interfaces step — and recording diagnostics + resolutions
 * in `guard/setup.json` — is the setup engine's job, not this module's: like
 * `interface-author/author.ts`, this module is driver- and store-agnostic and
 * takes both as parameters.
 *
 * Deferred, deliberately: a filesystem-diff observation channel (run the entry,
 * diff what it wrote) does not exist in the sandbox layer yet (no fs-diff v1);
 * when it lands, `run_entry` grows a second fact source without a shape change.
 *
 * CACHE: author-class. Same diagnostics against the same recipe resolve the
 * same way, so the outcome rides `cachedSessionOutcome` under
 * `guard/reconcile-interfaces`, keyed on the prompt fingerprint + the canonical
 * diagnostics JSON + the recipe fingerprint. The fold re-validates on hits.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  defineSessionTool,
  runAgentLoop,
  type SessionDef,
  type SessionDriver,
  type SessionEvent,
  type SessionOutcome,
  type SessionPersistence,
  type SessionTool,
} from '@truecourse/agent-loop'
import {
  createSandboxProbeExec,
  type CliProbeExec,
  type MapperDiagnostic,
} from '@truecourse/interface-mapper'
import { interfaceFingerprint, type Interface } from '@truecourse/shared'
import { cachedSessionOutcome, promptFingerprint } from '../agent/session-cache.js'

export const RECONCILE_INTERFACES_SESSION_KIND = 'guard-setup.reconcile-interfaces'
export const RECONCILE_INTERFACES_CACHE_NAME = 'guard/reconcile-interfaces'
/** The work item, as the session index and the transcript record it. */
export const RECONCILE_INTERFACES_WORK_ITEM = 'cli:reconcile'

/**
 * The three numbers. The job is a handful of `run_entry` observations —
 * one or two per disputed subject, and subjects cluster (one `--help` answers
 * every flag dispute of its command) — then a check-and-produce close; 10 turns
 * covers that. One resume grant for a long dispute list, and a low ceiling: the
 * context is help transcripts, not source.
 */
export const RECONCILE_INTERFACES_BUDGET = { turns: 10, maxResumes: 1, tokenCeiling: 100_000 }

// ---------------------------------------------------------------------------
// the outcome
// ---------------------------------------------------------------------------

/**
 * One diagnostic settled. `resolution` says WHOSE claim observation confirmed:
 * `tree-right` = the tree's (a listed-but-nonexistent probe fact is dropped),
 * `probe-right` = the probe's (a registered-but-nonexistent tree fact is
 * dropped), `both` = both observations are correct at once (a hidden flag: the
 * tree registers it AND the help omits it — the fact stays), `unknown` = the
 * observation could not establish it. `unknown` is legal and honest; a guess is
 * neither.
 */
export const InterfaceResolutionSchema = z
  .object({
    /** The diagnostic's `subject`, verbatim. */
    subject: z.string().min(1),
    resolution: z.enum(['tree-right', 'probe-right', 'both', 'unknown']),
    /** What was observed — quoted program output, or why nothing could be. */
    evidence: z.string().min(1),
  })
  .strict()
export type InterfaceResolution = z.infer<typeof InterfaceResolutionSchema>

/** The session outcome: every briefed subject answered, each exactly once. */
export const ReconcileResolutionsSchema = z
  .object({
    resolutions: z.array(InterfaceResolutionSchema).min(1),
  })
  .strict()
export type ReconcileResolutions = z.infer<typeof ReconcileResolutionsSchema>

/**
 * The one validation, shared verbatim by the `check_resolutions` tool and the
 * fold: every diagnostic answered, exactly once, and nothing answered that was
 * never asked. Returns the problems; empty = valid.
 */
export function validateResolutions(
  diagnostics: readonly MapperDiagnostic[],
  resolutions: readonly InterfaceResolution[],
): string[] {
  const problems: string[] = []
  const asked = new Set(diagnostics.map((d) => d.subject))
  const seen = new Set<string>()
  for (const resolution of resolutions) {
    if (!asked.has(resolution.subject)) {
      problems.push(`\`${resolution.subject}\` is not one of the briefed subjects — answer them verbatim`)
      continue
    }
    if (seen.has(resolution.subject)) {
      problems.push(`\`${resolution.subject}\` is answered twice — one resolution per subject`)
      continue
    }
    seen.add(resolution.subject)
  }
  for (const subject of asked) {
    if (!seen.has(subject)) problems.push(`\`${subject}\` is not answered — every subject gets a resolution (\`unknown\` is legal)`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// the session
// ---------------------------------------------------------------------------

export interface ReconcileSessionInput {
  /** The disputes, exactly as the union reported them. */
  diagnostics: readonly MapperDiagnostic[]
  /** The resolved recipe entry — what `run_entry` prefixes every spawn with. */
  entry: readonly string[]
  /**
   * Runs one probe with the FULL argv, fresh sandbox per call. Injectable for
   * tests; defaults to {@link createSandboxProbeExec}. Pass one built with the
   * recipe's env when the program needs it.
   */
  exec?: CliProbeExec
}

export function reconcileInterfacesSessionDef(
  input: ReconcileSessionInput,
): SessionDef<ReconcileResolutions> {
  return {
    kind: RECONCILE_INTERFACES_SESSION_KIND,
    systemPrompt: RECONCILE_INTERFACES_SYSTEM_PROMPT,
    tools: buildReconcileTools(input),
    outcomeSchema: ReconcileResolutionsSchema,
    budget: RECONCILE_INTERFACES_BUDGET,
    // The structural half of "check before you produce": the validator is the
    // exact check the fold runs, and a subject dropped on the way to the
    // outcome costs the whole outcome a round trip. Same mechanism as
    // interface authoring's check_draft precondition (01 step 2k).
    outcomePrecondition: {
      tool: 'check_resolutions',
      message:
        'Outcome refused: you never ran `check_resolutions` in this session. Call it on your complete resolution list now — it runs the exact validation the fold will run (every briefed subject answered exactly once). Fix anything it reports, then call `outcome` again.',
    },
  }
}

/** Caps — a tool result is context, and context is the budget. */
const MAX_STREAM_CHARS = 6_000

function buildReconcileTools(input: ReconcileSessionInput): SessionTool[] {
  const exec = input.exec ?? createSandboxProbeExec()
  return [
    defineSessionTool({
      name: 'run_entry',
      description:
        'Run the program under test with the given arguments, in a fresh sandbox. The argv is appended to the resolved entry the briefing states — pass `["add", "--help"]`, never the binary path. Returns the exit code and both streams. Each call is a fresh world: nothing persists between calls.',
      kind: 'run-entry',
      readOnly: false,
      destructive: false,
      inputSchema: z
        .object({
          argv: z.array(z.string()).describe('Arguments appended to the entry, e.g. `["add", "--help"]`.'),
        })
        .strict(),
      async execute(args) {
        try {
          const capture = await exec([...input.entry, ...args.argv])
          const lines = [
            `$ ${[...input.entry, ...args.argv].join(' ')}`,
            `exit: ${capture.exitCode === null ? 'none (killed or never finished)' : capture.exitCode}`,
            `--- stdout ---`,
            clip(capture.stdout),
            `--- stderr ---`,
            clip(capture.stderr),
          ]
          return { content: lines.join('\n') }
        } catch (error) {
          return { content: `the probe could not run: ${message(error)}`, isError: true }
        }
      },
    }),
    defineSessionTool({
      name: 'check_resolutions',
      description:
        'Check a complete resolution list against the rule the fold enforces: every briefed subject answered exactly once (`unknown` is a legal answer), and nothing answered that was not briefed. Call it before you produce the outcome.',
      kind: 'check-resolutions',
      readOnly: true,
      destructive: false,
      // The validator-as-tool pattern: this IS the outcome schema, and the
      // check is the exact one the fold runs — clean here cannot be refused there.
      inputSchema: ReconcileResolutionsSchema,
      async execute(args) {
        const problems = validateResolutions(input.diagnostics, args.resolutions)
        if (problems.length > 0) {
          return { content: `${problems.length} problem(s):\n- ${problems.join('\n- ')}`, isError: true }
        }
        const settled = args.resolutions.filter((r) => r.resolution !== 'unknown').length
        return {
          content: `All ${input.diagnostics.length} subject(s) answered (${settled} settled, ${
            args.resolutions.length - settled
          } unknown). Produce this as the outcome.`,
        }
      },
    }),
  ]
}

function clip(text: string): string {
  if (text.length === 0) return '(empty)'
  if (text.length <= MAX_STREAM_CHARS) return text
  return `${text.slice(0, MAX_STREAM_CHARS)}\n… clipped at ${MAX_STREAM_CHARS} of ${text.length} characters.`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The opening message: the entry, then every dispute with both derivations'
 * claims. The `detail` the union wrote IS the two-sided claim — it names what
 * the tree registers and what the help lists — so the briefing states it
 * verbatim rather than restating it.
 */
export function reconcileInterfacesBriefing(input: {
  diagnostics: readonly MapperDiagnostic[]
  entry: readonly string[]
}): string {
  const lines = [
    `Settle ${input.diagnostics.length} disagreement(s) between the two cli derivations by running the program.`,
    ``,
    `  entry  ${input.entry.join(' ')}`,
    ``,
    `\`run_entry\` appends your argv to that entry in a fresh sandbox. The disputes,`,
    `each with both derivations' claim:`,
  ]
  input.diagnostics.forEach((diagnostic, index) => {
    lines.push(
      ``,
      `${index + 1}. subject: ${diagnostic.subject}`,
      `   kind:    ${diagnostic.kind}`,
      `   claims:  ${diagnostic.detail}`,
    )
  })
  lines.push(
    ``,
    `Answer EVERY subject above, verbatim, exactly once. \`tree-right\` when the`,
    `program shows the tree's claim is the correct one, \`probe-right\` when it shows`,
    `the help's claim is, \`both\` when both observations hold at once (a flag that`,
    `works but is hidden from help), \`unknown\` when what you observed settles`,
    `nothing. Run \`check_resolutions\` on the complete list before the outcome.`,
  )
  return lines.join('\n')
}

const RECONCILE_INTERFACES_SYSTEM_PROMPT = `You reconcile a command-line program's interface catalog for TrueCourse: two derivations disagreed about what the program accepts, and you settle each dispute by RUNNING THE PROGRAM.

# The two witnesses

- The TREE derivation read the program's own source registrations.
- The PROBE derivation read the program's help output.

Each dispute is one fact exactly one of them stated: a flag or a command the other did not see. Your job is to observe which claim the program itself confirms.

# How to observe

You have ONE window onto the program: \`run_entry\`, which runs it with your arguments in a fresh sandbox and returns the exit code and both streams. You cannot read the source, and you must not want to — the source is where the tree's claim came from.

What settles a dispute:

- \`<command> --help\` output that lists (or omits) the flag or command in question. An omission alone does not prove absence — hidden flags exist — but a listing proves presence.
- Actually PASSING the disputed flag or command. A clean run (or an error about the flag's VALUE) proves the flag is real; an "unknown option" / "unknown command" error proves it is not. Read the error text — an exit code alone does not say which.
- Cluster your observations: one \`--help\` of a command answers every flag dispute on that command; run it once and read it for all of them.

What does NOT settle a dispute:

- A crash, a timeout, or an environment error says nothing about the flag. That subject is \`unknown\`, with the evidence saying what happened.
- Plausibility. A flag that "should" exist and a help style you recognize are guesses, and a guess written as a resolution corrupts a catalog scenarios run against.

# The resolutions

- \`tree-right\` — the program confirms the tree's claim; the probe-side fact is phantom.
- \`probe-right\` — the program confirms the probe's claim; the tree-side fact is phantom.
- \`both\` — both observations are correct at once: the canonical case is a flag the program accepts but withholds from help. The fact stays in the catalog.
- \`unknown\` — observation could not establish it. Legal, honest, and better than either wrong answer: an unknown leaves the catalog exactly as the union built it.

Every resolution carries \`evidence\`: the output you observed, quoted — the line of help, the error text, the clean exit. "I ran it and it worked" is not evidence; the text is.

# How to work

1. Read the dispute list. Group subjects by command.
2. \`run_entry\` per group — usually \`["<command>", "--help"]\` first, then a direct invocation for anything help left open.
3. Resolve every subject. Do not skip one, do not invent one, do not answer one twice.
4. \`check_resolutions\` on the complete list — it runs the exact validation the fold runs.
5. Produce the outcome.`

/** The prompt half of the cache key — folding it means editing the prompt above
 *  invalidates exactly this kind's cache. */
export const RECONCILE_INTERFACES_PROMPT_FINGERPRINT = promptFingerprint(
  RECONCILE_INTERFACES_SYSTEM_PROMPT,
)

/**
 * `sha256(PROMPT_FP :: canonical diagnostics JSON :: recipeFingerprint)`. The
 * diagnostics are canonicalized (fixed field order, sorted by subject then
 * kind) so the key depends on WHAT is disputed, never on derivation order.
 */
export function reconcileInterfacesCacheKey(
  diagnostics: readonly MapperDiagnostic[],
  recipeFingerprint: string,
): string {
  const canonical = [...diagnostics]
    .map((d) => ({ surface: d.surface, kind: d.kind, subject: d.subject, detail: d.detail }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind))
  return createHash('sha256')
    .update(
      [RECONCILE_INTERFACES_PROMPT_FINGERPRINT, JSON.stringify(canonical), recipeFingerprint].join('::'),
      'utf-8',
    )
    .digest('hex')
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

export interface ReconcileInterfacesRunOptions {
  repoRoot: string
  /**
   * The disputes to settle — the union's cli diagnostics. The caller passes the
   * kinds `run_entry` can observe (the four cli `*-missing-*` kinds); a
   * merge-time `authored-place-not-derived` diagnostic is not a question a
   * program run answers and belongs in the work-list report, not here.
   */
  diagnostics: readonly MapperDiagnostic[]
  /** The resolved recipe entry (`resolveEntry`'s output) `run_entry` spawns. */
  entry: readonly string[]
  /** Folded into the cache key: a recipe move re-asks every dispute. */
  recipeFingerprint: string
  /**
   * The session driver, LAZILY: resolved only when a session must actually run,
   * so a cache hit (and the empty-diagnostics zero-session path) never pays
   * for it.
   */
  driver: () => Promise<SessionDriver>
  persistence: SessionPersistence
  /** See {@link ReconcileSessionInput.exec}. */
  exec?: CliProbeExec
  signal?: AbortSignal
  /** Every transcript event, as it is persisted — the CLI's live line. */
  onSessionEvent?: (event: SessionEvent) => void
  mintSessionId?: () => string
  now?: () => string
}

export interface ReconcileInterfacesRunResult {
  /**
   * `null` when the diagnostics list was empty — zero sessions, by contract:
   * nothing was disputed, so there is nothing to run, cache, or record.
   */
  outcome: (SessionOutcome<ReconcileResolutions> & { fromCache?: true }) | null
  /** Present iff a session actually ran (absent on a cache hit and on `null`). */
  sessionId?: string
}

/**
 * Run the reconciliation session — at most one per call, zero when nothing is
 * disputed — through the outcome cache. The caller folds: validate with
 * {@link validateResolutions}, apply with {@link applyReconcileResolutions},
 * record diagnostics + resolutions in the setup report. This function writes
 * nothing anywhere (the cache entry aside).
 */
export async function runReconcileInterfacesSession(
  opts: ReconcileInterfacesRunOptions,
): Promise<ReconcileInterfacesRunResult> {
  if (opts.diagnostics.length === 0) return { outcome: null }

  let sessionId: string | undefined
  const outcome = await cachedSessionOutcome<ReconcileResolutions>({
    repoRoot: opts.repoRoot,
    cacheName: RECONCILE_INTERFACES_CACHE_NAME,
    key: reconcileInterfacesCacheKey(opts.diagnostics, opts.recipeFingerprint),
    schema: ReconcileResolutionsSchema,
    run: async () => {
      const driver = await opts.driver()
      sessionId = (opts.mintSessionId ?? (() => globalThis.crypto.randomUUID()))()
      return runAgentLoop<ReconcileResolutions>({
        def: reconcileInterfacesSessionDef({
          diagnostics: opts.diagnostics,
          entry: opts.entry,
          ...(opts.exec ? { exec: opts.exec } : {}),
        }),
        workItem: RECONCILE_INTERFACES_WORK_ITEM,
        initialMessages: [
          reconcileInterfacesBriefing({ diagnostics: opts.diagnostics, entry: opts.entry }),
        ],
        driver,
        persistence: opts.onSessionEvent
          ? teePersistence(opts.persistence, opts.onSessionEvent)
          : opts.persistence,
        sessionId,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      }).outcome
    },
  })
  return { outcome, ...(sessionId ? { sessionId } : {}) }
}

/** The pool has its own tee; a single session tees here — events pass to the
 *  observer AFTER the shell stamped them, reads untouched. */
function teePersistence(
  persistence: SessionPersistence,
  observe: (event: SessionEvent) => void,
): SessionPersistence {
  return {
    appendEvent(sessionId, event) {
      persistence.appendEvent(sessionId, event)
      observe(event)
    },
    updateIndex: (entry) => persistence.updateIndex(entry),
    readEvents: (sessionId) => persistence.readEvents(sessionId),
  }
}

// ---------------------------------------------------------------------------
// the fold's pure half
// ---------------------------------------------------------------------------

export interface ApplyResolutionsInput {
  /** The in-memory catalog interfaces (any surface; only `cli` entries move). */
  interfaces: readonly Interface[]
  /** The diagnostics the session was briefed on — the structured identities. */
  diagnostics: readonly MapperDiagnostic[]
  /** The session's (validated) resolutions. */
  resolutions: readonly InterfaceResolution[]
}

export interface ApplyResolutionsResult {
  interfaces: Interface[]
  /** One line per edit actually made — what the setup report records. */
  changes: string[]
}

/**
 * Apply the session's resolutions to the in-memory catalog — PURE, before the
 * snapshot write. Facts only, and only REMOVALS: the union already carries
 * every fact either witness stated, so confirming one (`both`, or the side
 * WITH the fact being right) changes nothing, and only a resolution proving a
 * fact phantom takes it out:
 *
 * - `tree-missing-flag` + `tree-right`   → the probe-filled flag comes off;
 * - `probe-missing-flag` + `probe-right` → the tree-registered flag comes off;
 * - `tree-missing-command` + `tree-right`     → the probe-filled command drops;
 * - `probe-missing-command` + `probe-right`   → the tree command drops;
 * - everything else — `both`, the confirming direction, and every `unknown` —
 *   leaves the catalog EXACTLY as the union built it.
 *
 * A removed flag re-fingerprints its interface (the grammar moved, so the
 * identity moves — same rule as the union adding it); a removed command
 * removes its interface. Resolutions whose subject matches no diagnostic, and
 * diagnostics without a structured cli identity (`command`), are ignored:
 * validation upstream already refused the former, and the latter are not
 * catalog edits (`authored-place-not-derived` is a work-list fact).
 */
export function applyReconcileResolutions(input: ApplyResolutionsInput): ApplyResolutionsResult {
  const bySubject = new Map(input.diagnostics.map((d) => [d.subject, d]))
  const dropFlags = new Map<string, Set<string>>() // command key → flags to remove
  const dropCommands = new Set<string>() // command keys to remove

  for (const resolution of input.resolutions) {
    const diagnostic = bySubject.get(resolution.subject)
    if (!diagnostic?.command) continue
    const key = diagnostic.command.join(' ')
    const phantomFlag =
      (diagnostic.kind === 'tree-missing-flag' && resolution.resolution === 'tree-right') ||
      (diagnostic.kind === 'probe-missing-flag' && resolution.resolution === 'probe-right')
    const phantomCommand =
      (diagnostic.kind === 'tree-missing-command' && resolution.resolution === 'tree-right') ||
      (diagnostic.kind === 'probe-missing-command' && resolution.resolution === 'probe-right')
    if (phantomFlag && diagnostic.flag) {
      const flags = dropFlags.get(key) ?? new Set<string>()
      flags.add(diagnostic.flag)
      dropFlags.set(key, flags)
    } else if (phantomCommand) {
      dropCommands.add(key)
    }
  }
  if (dropFlags.size === 0 && dropCommands.size === 0) {
    return { interfaces: [...input.interfaces], changes: [] }
  }

  const interfaces: Interface[] = []
  const changes: string[] = []
  for (const iface of input.interfaces) {
    const step = iface.steps[0]
    if (iface.type !== 'cli' || step?.kind !== 'invoke') {
      interfaces.push(iface)
      continue
    }
    const key = step.command.join(' ')
    if (dropCommands.has(key)) {
      changes.push(`dropped phantom command \`${key}\` (${iface.id})`)
      continue
    }
    const remove = dropFlags.get(key)
    const removed = remove ? step.flags.filter((flag) => remove.has(flag)) : []
    if (removed.length === 0) {
      interfaces.push(iface)
      continue
    }
    const steps = [{ ...step, flags: step.flags.filter((flag) => !remove!.has(flag)) }]
    interfaces.push({
      ...iface,
      steps,
      // The grammar moved, so the identity moves — the exact mirror of the
      // union having added the flag in the first place.
      fingerprint: interfaceFingerprint({ type: iface.type, entry: iface.entry, steps }),
    })
    for (const flag of removed) changes.push(`dropped phantom flag \`${flag}\` from \`${key}\``)
  }
  return { interfaces, changes }
}
