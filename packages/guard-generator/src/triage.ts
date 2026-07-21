/**
 * Finding triage — the post-settle judgment stage. Once birth validation and the
 * fidelity review have produced the run's birth/fidelity findings, ONE triage call
 * per finding decides what it actually is and how to unblock it: a verdict
 * (`doc-drift` | `code-drift` | `generation-defect` | `environment`), a confidence,
 * a one-paragraph brief, and a concrete recommendation. Everything the call needs
 * is already stored on the finding — the claim, the bound section's own text, the
 * authored YAML, expected/actual, the failing step's raw output — plus the section's
 * grounding probe transcripts (re-derived from the finding's claim, a cache hit).
 *
 * Output-only, like every other guard stage: the runner returns the model's raw
 * parsed JSON and the engine Zod-validates it here with ONE corrective re-ask, then
 * fail-soft — a still-invalid or thrown call ships the finding WITHOUT triage (the
 * verdict is advisory, never load-bearing). Verdicts are content-keyed-cached under
 * `guard/triage` on the finding's identity, so a re-generate re-triages only new or
 * changed findings.
 *
 * The verdict is a RECOMMENDATION with quoted evidence — never auto-applied. The
 * user stays the judge, exactly like conflict resolution.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  GUARD_FORMAT_VERSION,
  GuardTriageSchema,
  type GuardBirthFinding,
  type GuardTriage,
} from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import type { OutputCorrection } from './prompts.js'
import type { ProbeTranscript } from './ground.js'
import { quoteInvalidOutput } from './validate.js'

export const TRIAGE_CACHE_NAME = 'guard/triage'

/** The triage verdict JSON Schema, rendered from the SAME Zod definition the engine
 *  validates the reply with — so the prompt and the parser can never drift. */
const TRIAGE_JSON_SCHEMA = jsonSchemaHint(GuardTriageSchema)

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export const TRIAGE_SYSTEM_PROMPT = `\
You triage ONE guard FINDING — a candidate test scenario that did not become a
committed guard, either because it failed birth validation twice (a scenario built
from a spec CLAIM ran against the real program and disagreed) or because the
fidelity reviewer judged it did not truly verify its claim. Your ONE job: decide
what the finding actually is, and recommend how to unblock it. You return JSON only
— no prose.

${OUTPUT_ONLY_GUARDRAIL}

# The four verdicts
Read the CLAIM (in its section's own words), the authored scenario, the expected vs
actual, the failing program output, and the real-behavior probes, then choose EXACTLY
one:
- doc-drift — the DOC is wrong. The program's real behavior is fine; the claim/section
  states something the code no longer (or never did) do. Your recommendation QUOTES the
  exact doc line to change and gives its replacement.
- code-drift — the CODE is wrong. The doc's promise is the intended contract and the
  program violates it (a real bug the finding caught). Your recommendation names the
  observed behavior vs the promise.
- generation-defect — the SCENARIO is faulty: it asserts the wrong value, uses a wrong
  flag/subcommand, seeds the wrong world, or tests something the claim never said. The
  doc and code do not actually disagree. Your recommendation is dismiss-or-retry with the
  reason.
- environment — the failure is an artefact of the sandbox/run (missing world-state,
  timing, a probe that never really exercised the behavior), not a doc-vs-code
  disagreement. Your recommendation is dismiss-or-retry with the reason.

# The bar
Prefer doc-drift / code-drift ONLY when the evidence shows a genuine doc-vs-code
disagreement on the value the claim is about. When the scenario simply mis-tests the
claim, that is a generation-defect, not drift. State your confidence honestly.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${TRIAGE_JSON_SCHEMA}
Concretely — a code-drift example (right shape):
  { "verdict": "code-drift", "confidence": "high",
    "brief": "The section promises \`done <id>\` prints \`Completed t<N> ✓\`, but the run shows it prints \`Marked t1 as done\`. The scenario faithfully asserts the promised message; the program emits a different one, so the code diverges from the documented contract.",
    "recommendation": "Observed \`Marked t1 as done\` where the doc promises \`Completed t1 ✓\`. Fix the command's output to match the documented message, or update the doc if the new wording is intended." }
Wrong (do NOT do this): prose around the JSON, a missing field, or a verdict outside
the four allowed values.`

export const TRIAGE_PROMPT_FINGERPRINT = fingerprint(TRIAGE_SYSTEM_PROMPT)

export interface TriageUserContext {
  /** Repo-relative doc path the finding binds to — orientation only. */
  doc: string
  /** The bound section's heading, for context. */
  sectionHeading: string
  /** The section's own text — what the claim is read against. */
  sectionText: string
  /** The extracted claim the failed scenario was authored from. */
  claim: string
  /** Whether the finding came from birth validation or the fidelity reviewer. */
  kind: 'birth' | 'fidelity'
  /** The failed candidate's authored YAML — the exact commands it ran. */
  scenarioYaml: string
  /** The failing step index (1 for a fidelity finding — no step ran). */
  step: number
  /** What the scenario asserted. */
  expected: string
  /** What actually happened (the reviewer's mismatch for a fidelity finding). */
  actual: string
  /** The failing run's raw program stdout, when captured. */
  stdout?: string
  /** The failing run's raw program stderr, when captured. */
  stderr?: string
  /** Real empty-sandbox transcripts for the commands the claim names (may be empty). */
  probes?: ProbeTranscript[]
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

export function buildTriageUserPrompt(ctx: TriageUserContext): string {
  const lines = [
    `Document: ${ctx.doc}`,
    `Section: ${ctx.sectionHeading}`,
    `Finding kind: ${ctx.kind === 'fidelity' ? 'fidelity review (scenario passed birth but was judged not to verify the claim)' : 'birth validation (scenario failed against the real program twice)'}`,
    '',
    'SECTION TEXT (what the claim is read against):',
    '"""',
    ctx.sectionText,
    '"""',
    '',
    'CLAIM the scenario was authored from:',
    ctx.claim,
    '',
    'SCENARIO (the failed candidate — the exact commands it ran):',
    '"""',
    ctx.scenarioYaml,
    '"""',
    '',
    `Failing step: ${ctx.step}`,
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
      'generation-defect | environment, a "confidence" of high | medium | low, a',
      'one-paragraph "brief", and a concrete "recommendation" — and NOTHING else.',
    )
  }
  return lines.join('\n')
}

/** The injectable triage runner — output-only, returns the model's raw parsed JSON. */
export type TriageRunner = (input: TriageUserContext) => Promise<unknown>

/**
 * Per-finding triage cache key: it moves with the finding's IDENTITY (doc, anchor,
 * claim, expected, actual) and the triage prompt/format — so a re-generate that
 * re-produces the same finding is a cache hit and re-triages only new or changed
 * findings.
 */
export function triageCacheKey(finding: GuardBirthFinding): string {
  return createHash('sha256')
    .update(
      [
        TRIAGE_PROMPT_FINGERPRINT,
        String(GUARD_FORMAT_VERSION),
        finding.doc,
        finding.anchor,
        (finding.claim ?? '').replace(/\s+/g, ' ').trim(),
        finding.expected,
        finding.actual,
      ].join('::'),
    )
    .digest('hex')
}

/** The section context threaded into triage from the settle flow. */
export interface TriageSectionContext {
  sectionHeading: string
  sectionText: string
  probes: ProbeTranscript[]
}

/**
 * Triage ONE finding, cached per finding identity so a re-run is a hit and no
 * second triage call fires for an unchanged finding. Returns the verdict, or `null`
 * fail-soft — a thrown or (after one corrective re-ask) still-invalid call ships
 * the finding without triage. A validated verdict is cached; a failure is not.
 */
export async function runTriage(
  repoRoot: string,
  finding: GuardBirthFinding,
  section: TriageSectionContext,
  runner: TriageRunner,
): Promise<GuardTriage | null> {
  const cacheKey = triageCacheKey(finding)
  const cached = await getCacheEntry(repoRoot, TRIAGE_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = GuardTriageSchema.safeParse(cached)
    if (parsed.success) return parsed.data
  }

  const ctx: TriageUserContext = {
    doc: finding.doc,
    sectionHeading: section.sectionHeading,
    sectionText: section.sectionText,
    claim: finding.claim ?? '',
    kind: finding.kind ?? 'birth',
    scenarioYaml: finding.yaml ?? '',
    step: finding.step,
    expected: finding.expected,
    actual: finding.actual,
    ...(finding.stdout !== undefined ? { stdout: finding.stdout } : {}),
    ...(finding.stderr !== undefined ? { stderr: finding.stderr } : {}),
    probes: section.probes,
  }
  const verdict = await callTriageWithReask(ctx, runner)
  if (verdict === null) return null
  await setCacheEntry(repoRoot, TRIAGE_CACHE_NAME, cacheKey, verdict)
  return verdict
}

/**
 * Call the triage runner and validate its verdict; on a schema failure re-ask ONCE
 * with the invalid output quoted back, then validate again. A thrown call is not
 * re-asked. Returns `null` (fail-soft) on a still-invalid or thrown call.
 */
async function callTriageWithReask(ctx: TriageUserContext, runner: TriageRunner): Promise<GuardTriage | null> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch {
    return null
  }
  const first = GuardTriageSchema.safeParse(raw)
  if (first.success) return first.data

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch {
    return null
  }
  const second = GuardTriageSchema.safeParse(reRaw)
  return second.success ? second.data : null
}
