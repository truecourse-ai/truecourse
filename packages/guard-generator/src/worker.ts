/**
 * The flow worker: ONE agentic session that authors one (flow, surface)
 * scenario by drafting, executing in the sandbox, and revising against the
 * capture — the replacement for the staged one-shot authoring core. The
 * session's judgment IS the pipeline's: what a failing scenario means when the
 * worker commits it failing (real drift, with a diagnosis) is decided while
 * the flow is still open, not by an after-the-fact triage stage.
 *
 * The worker is pure orchestration over `runAgentLoop`: the engine hands it
 * the built prompt, the sandbox closures, and the turn seam; it hands back a
 * structured result that always exists — settled, blocked, journey-defect, or
 * an honest exhaustion the ledger escalates. The session state (transcript +
 * provider session id + last executed scenario) rides every result so the
 * engine can RESUME the same session with a later observation (a fidelity
 * flag, a confirmation flip).
 */

import { z } from 'zod'
import {
  jsonSchemaHint,
  runAgentLoop,
  type AgentLoopEvent,
  type AgentLoopUsage,
  type AgentToolDef,
  type LlmTurnFn,
  type LlmTurnMessage,
} from '@truecourse/shared/llm'
import {
  GuardTriageConfidenceSchema,
  type GuardFlow,
  type GuardScenario,
  type GuardScenarioResult,
  type GuardTriage,
} from '@truecourse/shared'
import { RawGeneratedCliScenarioSchema, type RawGeneratedCliScenario } from './schemas.js'
import { flattenZodError, uncoveredMilestones, unknownMilestones } from './validate.js'
import { WORKER_CLI_SYSTEM_PROMPT } from './prompts.js'

/** Turn cap per session (re-asks included) — §5's per-flow budget default. */
export const DEFAULT_WORKER_MAX_TURNS = 8
/** Token ceiling per session (input+output across turns). */
export const DEFAULT_WORKER_MAX_TOTAL_TOKENS = 500_000

export interface WorkerBlockedMilestone {
  milestone: number
  blockedOn: string[]
}

const WorkerBlockedMilestoneSchema = z.object({
  milestone: z.number().int().positive(),
  blockedOn: z.array(z.string().min(1)).min(1),
})

/**
 * The diagnosis a worker commits a FAILING scenario with. Deliberately
 * narrower than triage's verdict set: `generation-defect` is not a thing a
 * worker may settle on — a defective scenario is fixed in-loop or the budget
 * runs out honestly.
 */
const WorkerFailingSchema = z.object({
  verdict: z.enum(['code-drift', 'doc-drift']),
  confidence: GuardTriageConfidenceSchema,
  brief: z.string().min(1),
  recommendation: z.string().min(1),
})

const WorkerOutcomeSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('settled'),
    blockedMilestones: z.array(WorkerBlockedMilestoneSchema).optional(),
    failing: WorkerFailingSchema.optional(),
  }),
  z.object({
    result: z.literal('blocked'),
    blockedOn: z.array(z.string().min(1)).min(1),
    blockedMilestones: z.array(WorkerBlockedMilestoneSchema).optional(),
  }),
  z.object({
    result: z.literal('journey-defect'),
    argv: z.array(z.string()).optional(),
    promised: z.string().min(1),
    observed: z.string().min(1),
  }),
])
type WorkerOutcome = z.infer<typeof WorkerOutcomeSchema>

/** One executed draft: the raw authored scenario, its engine-built form, and
 *  the sandbox capture. The LAST one is what a settle commits. */
export interface WorkerLastRun {
  raw: RawGeneratedCliScenario
  scenario: GuardScenario
  result: GuardScenarioResult
}

/** The session state every result carries — what a resume needs. */
export interface WorkerSessionState {
  messages: LlmTurnMessage[]
  sessionId?: string
  usage: AgentLoopUsage
  lastRun?: WorkerLastRun
}

export type WorkerFlowResult =
  | {
      kind: 'settled'
      raw: RawGeneratedCliScenario
      scenario: GuardScenario
      runResult: GuardScenarioResult
      blockedMilestones: WorkerBlockedMilestone[]
      /** Present when the worker committed the scenario FAILING: its diagnosis,
       *  in the triage wire shape every read surface already renders. */
      failing?: GuardTriage
      session: WorkerSessionState
    }
  | {
      kind: 'blocked'
      blockedOn: string[]
      blockedMilestones: WorkerBlockedMilestone[]
      session: WorkerSessionState
    }
  | {
      kind: 'journey-defect'
      argv?: string[]
      promised: string
      observed: string
      session: WorkerSessionState
    }
  | {
      kind: 'exhausted'
      reason: 'turn-budget' | 'token-budget' | 'malformed' | 'turn-error'
      detail?: string
      session: WorkerSessionState
    }

export interface WorkerFlowInput {
  flow: GuardFlow
  /** The fully-built per-flow user prompt (the same context blocks the
   *  one-shot author consumed — `buildAuthorUserPrompt`). */
  userPrompt: string
  turn: LlmTurnFn
  /** Engine closures — the worker never touches the corpus or the store. */
  buildScenario: (raw: RawGeneratedCliScenario) => GuardScenario
  /** First cheap defect (composition, invalid regex, doc-example fidelity) or
   *  null. Runs BEFORE the sandbox, so a defective draft costs no run. */
  validate: (raw: RawGeneratedCliScenario) => string | null
  runScenario: (scenario: GuardScenario) => Promise<GuardScenarioResult>
  budget?: { maxTurns?: number; maxTotalTokens?: number }
  stage?: string
  subject?: string
  model?: string
  fallbackModel?: string
  /** Per-turn wall-clock ceiling. */
  timeoutMs?: number
  /** Live transcript sink (the guard/authoring JSONL writer). */
  onEvent?: (ev: AgentLoopEvent) => void
  /**
   * Continue a prior worker session with a new observation (a fidelity flag,
   * a confirmation failure). `lastRun` seeds the settle gate — a confirmation
   * flip's evidence lets the session settle FAILING without a re-run.
   */
  resume?: {
    messages: LlmTurnMessage[]
    sessionId?: string
    observation: string
    lastRun?: WorkerLastRun
  }
}

const RUN_SCENARIO_ARGS_SCHEMA = jsonSchemaHint(
  z.object({ scenario: RawGeneratedCliScenarioSchema.strip() }),
)

const WORKER_OUTCOME_JSON_SCHEMA = jsonSchemaHint(WorkerOutcomeSchema)

/** Compact JSON for tool results — small enough to read, stable to diff. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 1)
}

/** The structured capture a run returns to the model: verdict, the first
 *  failure's detail, and advisory milestone coverage (enforced at settle). */
function toolCapture(
  flow: GuardFlow,
  raw: RawGeneratedCliScenario,
  result: GuardScenarioResult,
): Record<string, unknown> {
  const uncovered = uncoveredMilestones(flow, raw)
  const unknown = unknownMilestones(flow, raw)
  return {
    verdict: result.outcome,
    durationMs: result.durationMs,
    ...(result.failure
      ? {
          failure: {
            step: result.failure.step,
            expected: result.failure.expected,
            actual: result.failure.actual,
            ...(result.failure.stdout !== undefined ? { stdout: result.failure.stdout } : {}),
            ...(result.failure.stderr !== undefined ? { stderr: result.failure.stderr } : {}),
          },
        }
      : {}),
    ...(result.failedMilestone !== undefined ? { failedMilestone: result.failedMilestone } : {}),
    ...(uncovered.length || unknown.length
      ? {
          coverage: {
            ...(uncovered.length ? { milestonesWithoutSteps: uncovered } : {}),
            ...(unknown.length ? { stepsWithUnknownMilestones: unknown } : {}),
          },
        }
      : {}),
  }
}

/** Run one flow worker session to its structured end. Never throws for model,
 *  transport, or sandbox behavior. */
export async function runFlowWorker(input: WorkerFlowInput): Promise<WorkerFlowResult> {
  const flowOrders = new Set(input.flow.milestones.map((m) => m.order))
  let lastRun: WorkerLastRun | undefined = input.resume?.lastRun

  const runTool: AgentToolDef = {
    name: 'run_scenario',
    description:
      'Execute a draft scenario in a fresh hermetic sandbox. Returns the structured capture: verdict (pass|fail|error), the first failing step (expected vs actual, output excerpts), and advisory milestone coverage. A draft that fails validation costs no sandbox run.',
    schema: RUN_SCENARIO_ARGS_SCHEMA,
    run: async (args) => {
      const parsed = z.object({ scenario: RawGeneratedCliScenarioSchema }).safeParse(args)
      if (!parsed.success) {
        return json({ verdict: 'invalid', problem: flattenZodError(parsed.error) })
      }
      const raw = parsed.data.scenario
      const defect = input.validate(raw)
      if (defect) return json({ verdict: 'invalid', problem: defect })
      let scenario: GuardScenario
      try {
        scenario = input.buildScenario(raw)
      } catch (e) {
        return json({ verdict: 'invalid', problem: e instanceof Error ? e.message : String(e) })
      }
      const result = await input.runScenario(scenario)
      lastRun = { raw, scenario, result }
      return json(toolCapture(input.flow, raw, result))
    },
  }

  // The settle gate: outcome validation is where the worker's honesty rules
  // are ENFORCED, not asked for — a throw here re-asks the still-open session.
  const parseOutcome = (value: unknown): WorkerOutcome => {
    const parsed = WorkerOutcomeSchema.safeParse(value)
    if (!parsed.success) throw new Error(flattenZodError(parsed.error))
    const outcome = parsed.data
    if (outcome.result !== 'settled') return outcome
    if (!lastRun) {
      throw new Error(
        'nothing has been executed — run the scenario with run_scenario before settling',
      )
    }
    const blocked = new Set((outcome.blockedMilestones ?? []).map((b) => b.milestone))
    for (const order of blocked) {
      if (!flowOrders.has(order)) {
        throw new Error(`blockedMilestones names milestone ${order}, which the flow does not have`)
      }
    }
    const allowed = new Set([...flowOrders].filter((o) => !blocked.has(o)))
    if (allowed.size === 0) {
      throw new Error(
        'every milestone is named blocked — that is the `blocked` outcome, not a settle',
      )
    }
    const uncovered = uncoveredMilestones(input.flow, lastRun.raw, allowed)
    if (uncovered.length > 0) {
      throw new Error(
        `the last-run scenario leaves milestone(s) ${uncovered.join(', ')} unrealized — cover them, or name them in blockedMilestones`,
      )
    }
    const unknown = unknownMilestones(input.flow, lastRun.raw, allowed)
    if (unknown.length > 0) {
      throw new Error(
        `the last-run scenario tags step(s) with milestone(s) ${unknown.join(', ')} the settle does not cover`,
      )
    }
    if (outcome.failing && lastRun.result.outcome === 'pass') {
      throw new Error('the last run PASSED — drop the failing block, or revise the scenario')
    }
    if (!outcome.failing && lastRun.result.outcome !== 'pass') {
      throw new Error(
        'the last run did not pass — revise the scenario, settle failing with a diagnosis, or report blocked',
      )
    }
    return outcome
  }

  const loop = await runAgentLoop<WorkerOutcome>({
    turn: input.turn,
    system: WORKER_CLI_SYSTEM_PROMPT,
    user: input.resume ? input.resume.observation : input.userPrompt,
    tools: [runTool],
    outcome: {
      description:
        'the session outcome: settled (the LAST-RUN scenario, passing or failing-with-diagnosis), blocked, or journey-defect',
      schema: WORKER_OUTCOME_JSON_SCHEMA,
      parse: parseOutcome,
    },
    budget: {
      maxTurns: input.budget?.maxTurns ?? DEFAULT_WORKER_MAX_TURNS,
      maxTotalTokens: input.budget?.maxTotalTokens ?? DEFAULT_WORKER_MAX_TOTAL_TOKENS,
    },
    stage: input.stage,
    subject: input.subject,
    model: input.model,
    fallbackModel: input.fallbackModel,
    timeoutMs: input.timeoutMs,
    onEvent: input.onEvent,
    ...(input.resume
      ? { resume: { messages: input.resume.messages, sessionId: input.resume.sessionId } }
      : {}),
  })

  const session = (sessionId?: string): WorkerSessionState => ({
    messages: loop.messages,
    ...(sessionId ? { sessionId } : {}),
    usage: loop.usage,
    ...(lastRun ? { lastRun } : {}),
  })

  switch (loop.status) {
    case 'outcome': {
      const outcome = loop.outcome
      if (outcome.result === 'settled') {
        const run = lastRun!
        return {
          kind: 'settled',
          raw: run.raw,
          scenario: run.scenario,
          runResult: run.result,
          blockedMilestones: outcome.blockedMilestones ?? [],
          ...(outcome.failing ? { failing: outcome.failing } : {}),
          session: session(loop.sessionId),
        }
      }
      if (outcome.result === 'blocked') {
        return {
          kind: 'blocked',
          blockedOn: outcome.blockedOn,
          blockedMilestones: outcome.blockedMilestones ?? [],
          session: session(loop.sessionId),
        }
      }
      return {
        kind: 'journey-defect',
        ...(outcome.argv ? { argv: outcome.argv } : {}),
        promised: outcome.promised,
        observed: outcome.observed,
        session: session(loop.sessionId),
      }
    }
    case 'malformed':
      return { kind: 'exhausted', reason: 'malformed', detail: loop.detail, session: session(loop.sessionId) }
    case 'turn-budget':
      return { kind: 'exhausted', reason: 'turn-budget', session: session(loop.sessionId) }
    case 'token-budget':
      return { kind: 'exhausted', reason: 'token-budget', session: session(loop.sessionId) }
    case 'turn-error':
      return { kind: 'exhausted', reason: 'turn-error', detail: loop.error, session: session(loop.sessionId) }
  }
}
