/**
 * THE FLOW-WORKER SESSION — `guard-generate.flow-worker` (plan 04 step 17), one
 * per (flow, surface with a realization plan). The pivot of the generate
 * pipeline's session move: the one-shot author → birth-retry → fidelity →
 * triage stages collapse into ONE session that authors, runs, revises and
 * adjudicates in a loop over exactly two tools.
 *
 * The tool surface is deliberately tiny — NO filesystem tools: the briefing IS
 * the journeys-only grounding (today's `buildAuthorCtx` payload, rendered by
 * the engine), and the two tools are the only way to touch the world:
 *  - `run_scenario`  — det pre-flight, then ONE fresh-sandbox execution, then
 *    the condensed result. A pre-flight defect returns as an error WITHOUT
 *    execution, so a malformed draft costs a turn, not a sandbox.
 *  - `submit_scenario` — the engine-side done-gate: a fresh confirmation run,
 *    the fidelity CHILD on a green (step 18, via `ctx.dispatchChild`), and the
 *    red-prediction gate on a red. Acceptance stashes the yaml ENGINE-side and
 *    names the sha the outcome must reference — the fold takes the yaml from
 *    the stash, never from the outcome text.
 *
 * Both engine halves live in `@truecourse/guard-generator` (the
 * {@link FlowWorkerTask} closures); this module owns the session shape — the
 * system prompts (the one-shot authoring doctrine plus the worker addendum),
 * the outcome contract, and the cache key. Tools never write repo/store state;
 * every write happens in the engine's routing fold.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool, type ToolContext } from '@truecourse/agent-loop'
import {
  GuardExpectedRedSchema,
  GuardFlowWorkerOutcomeSchema,
  type GuardDriverId,
  type GuardFlowWorkerOutcome,
} from '@truecourse/shared'
import {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_WEB_SYSTEM_PROMPT,
  workerCacheKey,
  type FlowWorkerTask,
  type WorkerFidelityJudge,
} from '@truecourse/guard-generator'
import { promptFingerprint } from '../agent/session-cache.js'

export const FLOW_WORKER_SESSION_KIND = 'guard-generate.flow-worker'

/** Cache name KEPT from the one-shot author stage (`guard/generate`) — the
 *  session keys swap in their own prompt fingerprint, so the two generations
 *  never collide (see {@link flowWorkerCacheKey}). */
export const FLOW_WORKER_CACHE_NAME = 'guard/generate'

/** The three numbers (§3.3): the loop is draft → run → revise → submit, and a
 *  hard flow legitimately takes several sandbox rounds plus a fidelity
 *  correction; 25 turns with ONE resume grant covers it without letting a
 *  thrashing worker run forever. */
export const FLOW_WORKER_BUDGET: SessionBudget = {
  turns: 25,
  maxResumes: 1,
  tokenCeiling: 200_000,
}

/**
 * The worker ADDENDUM — appended to the one-shot authoring doctrine (which
 * stays the vocabulary/faithfulness source of truth, reused VERBATIM so prompt
 * lessons carry over). It overrides exactly two things: the medium (YAML
 * through tools, not a one-shot JSON reply) and the ending (the FlowOutcome
 * object, not a scenario).
 */
const WORKER_ADDENDUM = `

# YOU ARE THE FLOW WORKER — the loop overrides the output contract above
Everything above about WHAT a faithful scenario is still binds you. But you do
NOT answer with one JSON object. You work a LOOP against the real program:
1. Draft the scenario as YAML — ONLY the fields \`title\`, \`setup\` (optional),
   \`steps\`, \`normalize\` (optional), exactly the fields the contract above
   defines. Never write \`id\`, \`flow\`, \`interface\`, \`binds\`, \`promise\`
   or \`server\` — the engine stamps those.
2. \`run_scenario\` it. The engine pre-flight-checks the draft (a defect comes
   back WITHOUT an execution), then runs it once in a fresh sandbox and shows
   you the condensed result. Revise on the evidence and run again.
3. When the scenario is right, \`submit_scenario\` it. The engine re-runs it in
   a fresh sandbox as the confirmation:
   - a GREEN confirmation is audited by an independent fidelity judge; a flag
     comes back as the tool error — revise so the scenario truly verifies the
     flagged milestone, then submit again;
   - a RED confirmation is accepted ONLY when you declared it: submit with
     \`expectedReds\` naming the failing step, the observed actual (copy it off
     your own run — the prediction proves you ran it), a verdict
     (\`doc-drift\` when the DOC is wrong, \`code-drift\` when the CODE is), and
     a one-paragraph brief. A red you can fix is a defect in YOUR scenario —
     fix it instead of declaring it.
4. On acceptance the engine stashes your yaml under a sha and tells you so.

# Editing committed scenarios
When the briefing carries a PRIOR SCENARIOS block, this flow is already covered
and you EDIT that coverage: \`submit_scenario\` with \`replaces: "<prior id>"\`
keeps the scenario's id (resubmitting it unchanged is right when nothing moved
under it); omit \`replaces\` only for a genuinely new obligation; \`drop_scenario\`
deletes a prior scenario whose obligation VANISHED from the spec — the reason
must name it, and a scenario you merely rewrote is replaced, never dropped.
At least one scenario must be accepted for a \`settled\` outcome; if none can
be, end \`blocked\` or \`retired\` and the committed scenarios stay as they are.
Without that block there is nothing to edit: never pass \`replaces\`.

# The outcome — how the session MUST end
Produce exactly one of these objects (nothing else ends the session):
- { "kind": "settled", "scenarioYamlSha": "<the sha the acceptance named, verbatim>",
    "expectedReds": [ ...exactly what you submitted, [] on a green ],
    "additionalScenarios": [ { "scenarioYamlSha", "expectedReds" } … ]   — ONLY when you had several accepted (edit mode); omit otherwise,
    "droppedScenarios": [ { "id", "reason" } … ]   — ONLY the drop_scenario calls the engine accepted; omit otherwise }
- { "kind": "blocked", "perMilestone": [ { "order": <milestone>, "capability": "<what the sandbox cannot provide>" } ] }
  — when the flow needs world-state or a third party the sandbox cannot offer.
  Name the capability precisely (the service, the credential, the fixture).
- { "kind": "journey-defect", "report": { "interfaceId": "<id>", "detail": "<what is wrong>" } }
  — when a derived interface you were briefed on does not match the real app
  (wrong path, wrong verbs, a screen that is not there). Report it instead of
  working around it with invented surface.
- { "kind": "retired", "attempts": <n>, "lastEvidence": "<why no faithful scenario could be produced>" }
  — when you tried and no faithful scenario can be made to pass or honestly
  fail. Retiring is honest; a vacuous green is not.
Never claim \`settled\` without an acceptance — the engine refuses a sha it
never stashed. Run before you conclude: a \`blocked\`/\`retired\` verdict with
no run behind it is refused once and costs you a turn.`

export const FLOW_WORKER_CLI_SYSTEM_PROMPT = GENERATE_SYSTEM_PROMPT + WORKER_ADDENDUM
export const FLOW_WORKER_API_SYSTEM_PROMPT = GENERATE_API_SYSTEM_PROMPT + WORKER_ADDENDUM
export const FLOW_WORKER_WEB_SYSTEM_PROMPT = GENERATE_WEB_SYSTEM_PROMPT + WORKER_ADDENDUM

/** Exported for the step-20 estimate rework (probe the REAL keys). */
export const FLOW_WORKER_CLI_PROMPT_FINGERPRINT = promptFingerprint(FLOW_WORKER_CLI_SYSTEM_PROMPT)
export const FLOW_WORKER_API_PROMPT_FINGERPRINT = promptFingerprint(FLOW_WORKER_API_SYSTEM_PROMPT)
export const FLOW_WORKER_WEB_PROMPT_FINGERPRINT = promptFingerprint(FLOW_WORKER_WEB_SYSTEM_PROMPT)

/** The per-surface prompt table — cli is also the fallback for a surface with no
 *  arm of its own, exactly the resolution the old ternary made. */
const SYSTEM_PROMPT_BY_SURFACE: Partial<Record<GuardDriverId, string>> = {
  cli: FLOW_WORKER_CLI_SYSTEM_PROMPT,
  api: FLOW_WORKER_API_SYSTEM_PROMPT,
  web: FLOW_WORKER_WEB_SYSTEM_PROMPT,
}
const PROMPT_FINGERPRINT_BY_SURFACE: Partial<Record<GuardDriverId, string>> = {
  cli: FLOW_WORKER_CLI_PROMPT_FINGERPRINT,
  api: FLOW_WORKER_API_PROMPT_FINGERPRINT,
  web: FLOW_WORKER_WEB_PROMPT_FINGERPRINT,
}

/** The system prompt one surface's workers author under. */
export function flowWorkerSystemPrompt(surface: GuardDriverId): string {
  return SYSTEM_PROMPT_BY_SURFACE[surface] ?? FLOW_WORKER_CLI_SYSTEM_PROMPT
}

/** Each surface authors under its own prompt, so a scenario's cache entry moves
 *  only when ITS prompt changes — the one-shot rule, kept. */
export function flowWorkerPromptFingerprint(surface: GuardDriverId): string {
  return PROMPT_FINGERPRINT_BY_SURFACE[surface] ?? FLOW_WORKER_CLI_PROMPT_FINGERPRINT
}

/**
 * The task's cache key: `authorCacheKey`'s exact recipe (`workerCacheKey` is
 * that recipe parameterized) with the SESSION prompt fingerprint swapped in.
 * Everything else that decides "does this flow re-author" is unchanged.
 */
export function flowWorkerCacheKey(task: FlowWorkerTask): string {
  const m = task.cacheMaterial
  return workerCacheKey(
    flowWorkerPromptFingerprint(task.surface),
    { fingerprint: m.flowFingerprint },
    task.surface,
    m.sectionKeys,
    m.interfaceFingerprints,
    m.recipeFingerprint,
    // Edit mode folds the briefed priors in: a from-scratch task keys exactly
    // as before, so every committed entry survives; an edit never serves a
    // scratch hit and vice versa.
    m.mode === 'edit' ? { priorShas: m.priorShas } : undefined,
  )
}

/**
 * One cached worker result: the completed outcome plus, for `settled`, the
 * engine-stashed yaml (the outcome's sha references run state that does not
 * survive the run, so the yaml must ride the entry). Only `settled` is
 * written — see {@link cacheableWorkerOutcome}; the shape still parses legacy
 * `blocked` entries so an old store never throws (they read as misses).
 */
export const CachedWorkerEntrySchema = z
  .object({
    outcome: GuardFlowWorkerOutcomeSchema,
    /** The single accepted yaml — the legacy one-scenario entry. */
    scenarioYaml: z.string().min(1).optional(),
    /** Every accepted yaml, index-aligned with `settledScenariosOf(outcome)` —
     *  written by edit-mode settles; a legacy entry reads as a one-element list. */
    scenarioYamls: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type CachedWorkerEntry = z.infer<typeof CachedWorkerEntrySchema>

/** The cached yamls, primary first — one list for legacy and edit-mode entries. */
export function cachedScenarioYamls(entry: CachedWorkerEntry): string[] {
  return entry.scenarioYamls ?? (entry.scenarioYaml ? [entry.scenarioYaml] : [])
}

/**
 * Which completed outcomes enter the cache: ONLY `settled` — the one shape
 * whose cache hit is re-proven against the live world (`confirmCached`) before
 * it stands. `blocked` is NOT cached (since the documenso 13-worker bench,
 * 2026-08-24): a block is a claim about the WORLD at run time — six cached
 * "Prisma P1017 / database unreachable" verdicts replayed as fromCache hits on
 * every retry with no re-verification path, permanently skipping flows whose
 * world was fine again. Like `retired` and `journey-defect`, a block is a
 * per-run event: the next run re-attempts it (blocked sessions are short).
 */
export function cacheableWorkerOutcome(outcome: GuardFlowWorkerOutcome): boolean {
  return outcome.kind === 'settled'
}

const runScenarioTool = (task: FlowWorkerTask): SessionTool =>
  defineSessionTool({
    name: 'run_scenario',
    description:
      'Run a draft scenario ONCE in a fresh sandbox. Pass the scenario as YAML (title, setup?, steps, normalize? — never id/flow/interface/binds). A deterministic pre-flight defect returns as an error WITHOUT an execution; otherwise you get the condensed run result (outcome, failing step, expected vs actual, output excerpts).',
    kind: 'run-scenario',
    // Executes the program under test in a disposable sandbox; repo and store
    // state are never written, which is what these two flags declare.
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ yaml: z.string().min(1) }).strict(),
    async execute(args) {
      return task.runScenario(args.yaml)
    },
  })

const submitScenarioTool = (
  task: FlowWorkerTask,
  judgeWith: (ctx: ToolContext) => WorkerFidelityJudge,
): SessionTool =>
  defineSessionTool({
    name: 'submit_scenario',
    description:
      'Submit the finished scenario for acceptance. The engine re-runs it in a FRESH sandbox: a green is audited by an independent fidelity judge; a red is accepted only when `expectedReds` declares the failing step with the observed actual, a doc-drift|code-drift verdict, and a brief. Acceptance names the sha your `settled` outcome must reference.',
    kind: 'submit-scenario',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        yaml: z.string().min(1),
        expectedReds: z.array(GuardExpectedRedSchema).default([]),
        /** Edit mode: the prior scenario this submission replaces (keeps its id). */
        replaces: z.string().min(1).optional(),
      })
      .strict(),
    async execute(args, ctx) {
      return task.submitScenario(args.yaml, args.expectedReds, judgeWith(ctx), args.replaces)
    },
  })

const dropScenarioTool = (task: FlowWorkerTask): SessionTool =>
  defineSessionTool({
    name: 'drop_scenario',
    description:
      'Edit mode only: delete a PRIOR scenario (by the id the PRIOR SCENARIOS block names) whose obligation VANISHED from the current spec text. The reason must name the vanished obligation. A scenario you merely rewrote is replaced via `submit_scenario` with `replaces`, never dropped.',
    kind: 'drop-scenario',
    // Records an intent the engine applies at persist; nothing is deleted here.
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        id: z.string().min(1),
        reason: z.string().min(1),
      })
      .strict(),
    async execute(args) {
      return task.dropScenario(args.id, args.reason)
    },
  })

export interface FlowWorkerSessionInput {
  task: FlowWorkerTask
  /** Build the fidelity judge for one tool invocation — needs the invocation's
   *  `ToolContext` (the `dispatchChild` seam lives there). */
  judgeWith: (ctx: ToolContext) => WorkerFidelityJudge
}

export function flowWorkerSessionDef(input: FlowWorkerSessionInput): SessionDef<GuardFlowWorkerOutcome> {
  const { task } = input
  return {
    kind: FLOW_WORKER_SESSION_KIND,
    systemPrompt: flowWorkerSystemPrompt(task.surface),
    tools: [runScenarioTool(task), submitScenarioTool(task, input.judgeWith), dropScenarioTool(task)],
    outcomeSchema: GuardFlowWorkerOutcomeSchema,
    budget: FLOW_WORKER_BUDGET,
    // The structural half of "run before you conclude" (01 step 2k): an
    // outcome from a worker that never executed anything is refused once —
    // even a `blocked` verdict is better grounded after one probe run.
    outcomePrecondition: {
      tool: 'run_scenario',
      message:
        'Outcome refused: you never ran `run_scenario` in this session. Run your draft (or a minimal probe of the blocking precondition) once — the evidence grounds whatever outcome you produce — then produce the outcome again.',
    },
  }
}
