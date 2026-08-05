/**
 * Failing-test triage — the post-birth judgment stage. Once every birth
 * round has settled, ONE triage call per FAILING TEST decides what the failure
 * actually is: a verdict (`code-drift` | `doc-drift` | `generation-defect`) plus a
 * confidence, a plain-words brief, and a concrete unblock recommendation. The
 * verdict attaches to the TEST — two tests of one flow may carry different
 * verdicts — and drives the birth-failure routing: repo-blamed failures
 * commit as red drift, generation defects are withheld into the auto-resolve loop.
 *
 * There is deliberately NO `environment` verdict: a failure whose evidence says
 * missing-setup routes to the needs-setup/blocked machinery BEFORE triage is
 * called — a state the runner detects, never an opinion a model holds.
 *
 * The evidence is the test's own journey transcript (the authored scenario, the
 * failing step, expected vs actual, the raw program output), the flow's spec text
 * (the failing milestone's section), and the request-surface grounding the
 * pipeline already holds: real empty-sandbox probes for a cli test, the plan's
 * inbound request contracts for an api test.
 *
 * Output-only, like every other guard stage: the runner returns the model's raw
 * parsed JSON and the engine Zod-validates it here with ONE corrective re-ask (and
 * ONE plain retry for a call that never answered at all — a timeout, a dead
 * transport), then fail-soft — a still-invalid or twice-thrown call ships the test
 * WITHOUT triage, and the run records the loss against that test
 * (an untriaged failing test commits, so the verdict is advisory to the routing's
 * conservative default, never load-bearing). Verdicts are content-keyed-cached
 * under `guard/triage` on the test's failure identity, so a re-generate
 * re-triages only new or changed failures.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  GUARD_FORMAT_VERSION,
  GuardTriageSchema,
  type GuardBirthFinding,
  type GuardDriverId,
  type GuardTriage,
} from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import type { JourneyContractHint, OutputCorrection } from './prompts.js'
import type { ProbeTranscript } from './ground.js'
import { callWithRetry, flattenZodError, quoteInvalidOutput } from './validate.js'

export const TRIAGE_CACHE_NAME = 'guard/triage'

/** The triage verdict JSON Schema, rendered from the SAME Zod definition the engine
 *  validates the reply with — so the prompt and the parser can never drift. */
const TRIAGE_JSON_SCHEMA = jsonSchemaHint(GuardTriageSchema)

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export const TRIAGE_SYSTEM_PROMPT = `\
You triage ONE FAILING guard TEST — a scenario authored from a spec FLOW (a
user-goal path over documented claims) that ran against the real program and
disagreed with it. Your ONE job: decide what the failure actually is, and
recommend how to unblock it. You return JSON only — no prose.

${OUTPUT_ONLY_GUARDRAIL}

# The three verdicts
Read the flow's milestones (each an extracted claim), the failing milestone's
section in its own words, the authored scenario, the expected vs actual, and the
raw program output, then choose EXACTLY one:
- doc-drift — the DOC is wrong. The program's real behavior is fine; the section
  states something the code no longer (or never did) do. Your recommendation QUOTES
  the exact doc line to change and gives its replacement.
- code-drift — the CODE is wrong. The doc's promise is the intended contract and
  the program violates it (a real bug the test caught). Your recommendation names
  the observed behavior vs the promise.
- generation-defect — the SCENARIO is faulty: it asserts the wrong value, uses a
  wrong flag/subcommand/endpoint, seeds the wrong world, or tests something the
  flow's claims never said. The doc and the code do not actually disagree. Your
  recommendation says what a faithful scenario would do differently.

There is NO "environment" verdict. Failures caused by missing world-state (an
unbooted service, an absent credential, unseeded data) are routed away
deterministically before you are called — never bend a verdict to say the sandbox
is missing something. A scenario that DEMANDED world-state the claims never
promised is a generation-defect.

# The bar
Prefer doc-drift / code-drift ONLY when the evidence shows a genuine doc-vs-code
disagreement on the value the claim is about. When the scenario simply mis-tests
the flow, that is a generation-defect, not drift. State your confidence honestly:
a high-confidence generation-defect verdict is acted on without a human.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${TRIAGE_JSON_SCHEMA}
Concretely — a code-drift example (right shape):
  { "verdict": "code-drift", "confidence": "high",
    "brief": "The section promises \`done <id>\` prints \`Completed t<N> ✓\`, but the run shows it prints \`Marked t1 as done\`. The scenario faithfully asserts the promised message; the program emits a different one, so the code diverges from the documented contract.",
    "recommendation": "Observed \`Marked t1 as done\` where the doc promises \`Completed t1 ✓\`. Fix the command's output to match the documented message, or update the doc if the new wording is intended." }
Wrong (do NOT do this): prose around the JSON, a missing field, or a verdict
outside the three allowed values.`

export const TRIAGE_PROMPT_FINGERPRINT = fingerprint(TRIAGE_SYSTEM_PROMPT)

/** One milestone of the failing test's flow, as triage sees the journey. */
export interface TriageMilestone {
  order: number
  claim: string
  /** True on the milestone the failing step realized. */
  failed?: boolean
  /** True on a milestone the (partial) scenario deliberately does not cover —
   *  blocked on a capability the sandbox lacks, never a defect of the test. */
  blocked?: boolean
}

export interface TriageUserContext {
  /** The flow the failing test realizes. */
  flow: { id: string; title: string; goal: string }
  /** The surface the test runs on. */
  surface: GuardDriverId
  /** The failing test's scenario id. ATTRIBUTION only — not rendered into the
   *  prompt; it names the test a lost verdict left untriaged. */
  scenarioId?: string
  /** Repo-relative doc the failing milestone's section lives in. */
  doc: string
  /** The failing milestone's section heading, for context. */
  sectionHeading: string
  /** The failing milestone's section text — what its claim is read against. */
  sectionText: string
  /** The flow's milestones in path order, the failing one marked. */
  milestones: TriageMilestone[]
  /** The failed test's authored YAML — the exact journey it ran. */
  scenarioYaml: string
  /** The failing step (1-based). */
  step: number
  /** The flow milestone the failing step realized, when the step carried one. */
  failedMilestone?: number
  /** What the scenario asserted. */
  expected: string
  /** What actually happened. */
  actual: string
  /** The failing run's raw program stdout, when captured. */
  stdout?: string
  /** The failing run's raw program stderr, when captured. */
  stderr?: string
  /** Real empty-sandbox transcripts for the failing claim's commands (cli tests). */
  probes?: ProbeTranscript[]
  /** The plan's inbound request contracts — what each walked operation's handler
   *  actually reads off the request (api tests). */
  journeyContracts?: JourneyContractHint[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

/** Indent every line of a program-output excerpt so it reads as one nested block. */
function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

/** The same trailing request-fields clause the authoring prompt renders. */
function contractLine(hint: JourneyContractHint): string {
  const parts: string[] = []
  for (const [label, fields] of [
    ['body', hint.bodyFields],
    ['query', hint.queryFields],
  ] as const) {
    if (!fields || fields.length === 0) continue
    const required = fields.filter((f) => f.required === true).map((f) => f.name)
    const rest = fields.filter((f) => f.required !== true).map((f) => f.name)
    const clauses: string[] = []
    if (required.length > 0) clauses.push(`requires ${required.join(', ')}`)
    if (rest.length > 0) clauses.push(`also reads ${rest.join(', ')}`)
    if (clauses.length > 0) parts.push(`${label} ${clauses.join('; ')}`)
  }
  return `- ${hint.method} ${hint.path}${parts.length > 0 ? ` — ${parts.join(' | ')}` : ''}`
}

export function buildTriageUserPrompt(ctx: TriageUserContext): string {
  const lines = [
    `Flow: "${ctx.flow.title}" (${ctx.flow.id}) — ${ctx.flow.goal}`,
    `Surface: ${ctx.surface}`,
    'Milestones (the flow path):',
    ...ctx.milestones.map(
      (m) =>
        `  ${m.order}. ${m.claim}${m.failed ? '   ← the failing step realized THIS milestone' : ''}${
          m.blocked ? '   (blocked on a missing capability — deliberately NOT covered by this test)' : ''
        }`,
    ),
    '',
    `Document: ${ctx.doc}`,
    `Section: ${ctx.sectionHeading}`,
    "SECTION TEXT (what the failing milestone's claim is read against):",
    '"""',
    ctx.sectionText,
    '"""',
    '',
    'SCENARIO (the failed test — the exact journey it ran):',
    '"""',
    ctx.scenarioYaml,
    '"""',
    '',
    `Failing step: ${ctx.step}${ctx.failedMilestone ? ` (milestone ${ctx.failedMilestone})` : ''}`,
    `Expected: ${ctx.expected}`,
    `Actual:   ${ctx.actual}`,
  ]
  if (ctx.stdout) lines.push('Program stdout:', indentBlock(ctx.stdout))
  if (ctx.stderr) lines.push('Program stderr:', indentBlock(ctx.stderr))
  if (ctx.probes && ctx.probes.length > 0) {
    lines.push('', 'REAL BEHAVIOR (captured in an empty sandbox — the program as it actually runs):')
    for (const p of ctx.probes) {
      lines.push(`$ ${p.command}`)
      lines.push(p.timedOut ? 'exit (timed out)' : `exit ${p.exit ?? '(killed, no exit code)'}`)
      if (p.stdout) lines.push('stdout:', p.stdout + (p.stdoutTruncated ? '\n…(truncated)' : ''))
      if (p.stderr) lines.push('stderr:', p.stderr + (p.stderrTruncated ? '\n…(truncated)' : ''))
      if (!p.stdout && !p.stderr) lines.push('(no output)')
    }
  }
  if (ctx.journeyContracts && ctx.journeyContracts.length > 0) {
    lines.push(
      '',
      "REQUEST SURFACE (what each walked operation's handler actually reads off the request):",
      ...ctx.journeyContracts.map(contractLine),
    )
  }
  lines.push(
    '',
    'Return exactly one JSON object: { "verdict", "confidence", "brief", "recommendation" }.',
  )
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with a "verdict" of doc-drift | code-drift |',
      'generation-defect, a "confidence" of high | medium | low, a one-paragraph',
      '"brief", and a concrete "recommendation" — and NOTHING else.',
    )
  }
  return lines.join('\n')
}

/** The injectable triage runner — output-only, returns the model's raw parsed JSON. */
export type TriageRunner = (input: TriageUserContext) => Promise<unknown>

/**
 * Per-test triage cache key: it moves with the FAILURE IDENTITY (the flow, the
 * surface, the failing milestone's section + claim, expected, actual) and with the
 * triage prompt/format — so a re-generate that reproduces the same failure is a
 * cache hit and re-triages only new or changed failures.
 */
export function triageCacheKey(finding: GuardBirthFinding): string {
  return createHash('sha256')
    .update(
      [
        TRIAGE_PROMPT_FINGERPRINT,
        String(GUARD_FORMAT_VERSION),
        finding.flowId ?? '',
        finding.surface ?? '',
        finding.doc,
        finding.anchor,
        (finding.claim ?? '').replace(/\s+/g, ' ').trim(),
        finding.expected,
        finding.actual,
      ].join('::'),
    )
    .digest('hex')
}

/** The flow-side context threaded into one triage call from the settle flow. */
export interface TriageFlowContext {
  flow: { id: string; title: string; goal: string }
  surface: GuardDriverId
  sectionHeading: string
  sectionText: string
  milestones: TriageMilestone[]
  probes?: ProbeTranscript[]
  journeyContracts?: JourneyContractHint[]
}

/** One triage outcome: the verdict, or the reason no verdict was reached. */
export type TriageResult = GuardTriage | { error: string }

/**
 * Triage ONE failing test, cached per failure identity so a re-run is a hit and no
 * second triage call fires for an unchanged failure. Returns the verdict, or
 * `{ error }` fail-soft — a call that threw twice, or (after one corrective re-ask)
 * still answered invalidly, ships the test without triage and the caller records
 * the loss against this test. A validated verdict is cached; a failure is not.
 */
export async function runTriage(
  repoRoot: string,
  finding: GuardBirthFinding,
  flowCtx: TriageFlowContext,
  runner: TriageRunner,
): Promise<TriageResult> {
  const cacheKey = triageCacheKey(finding)
  const cached = await getCacheEntry(repoRoot, TRIAGE_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = GuardTriageSchema.safeParse(cached)
    if (parsed.success) return parsed.data
  }

  const ctx: TriageUserContext = {
    flow: flowCtx.flow,
    surface: flowCtx.surface,
    ...(finding.scenarioId !== undefined ? { scenarioId: finding.scenarioId } : {}),
    doc: finding.doc,
    sectionHeading: flowCtx.sectionHeading,
    sectionText: flowCtx.sectionText,
    milestones: flowCtx.milestones,
    scenarioYaml: finding.yaml ?? '',
    step: finding.step,
    ...(finding.failedMilestone !== undefined ? { failedMilestone: finding.failedMilestone } : {}),
    expected: finding.expected,
    actual: finding.actual,
    ...(finding.stdout !== undefined ? { stdout: finding.stdout } : {}),
    ...(finding.stderr !== undefined ? { stderr: finding.stderr } : {}),
    ...(flowCtx.probes && flowCtx.probes.length > 0 ? { probes: flowCtx.probes } : {}),
    ...(flowCtx.journeyContracts && flowCtx.journeyContracts.length > 0
      ? { journeyContracts: flowCtx.journeyContracts }
      : {}),
  }
  const verdict = await callTriageWithReask(ctx, runner)
  if ('error' in verdict) return verdict
  await setCacheEntry(repoRoot, TRIAGE_CACHE_NAME, cacheKey, verdict)
  return verdict
}

/**
 * Call the triage runner and validate its verdict; a call that THREW is retried
 * once, and a call that answered unusably is re-asked ONCE with the invalid output
 * quoted back, then validated again. Returns `{ error }` (fail-soft) when both
 * attempts threw or the re-ask was still invalid.
 */
async function callTriageWithReask(ctx: TriageUserContext, runner: TriageRunner): Promise<TriageResult> {
  const attempt = await callWithRetry(runner, ctx)
  if ('error' in attempt) return { error: `call failed: ${attempt.error}` }
  const first = GuardTriageSchema.safeParse(attempt.raw)
  if (first.success) return first.data

  const reAttempt = await callWithRetry(runner, {
    ...ctx,
    correction: { invalidOutput: quoteInvalidOutput(attempt.raw) },
  })
  if ('error' in reAttempt) return { error: `re-ask failed: ${reAttempt.error}` }
  const second = GuardTriageSchema.safeParse(reAttempt.raw)
  return second.success ? second.data : { error: `output invalid after re-ask: ${flattenZodError(second.error)}` }
}
