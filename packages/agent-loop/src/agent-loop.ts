/**
 * `runAgentLoop` — the POLICY SHELL of the agentic pipeline
 * (AGENTIC_PIPELINE_PLAN §3.3, driver architecture 2026-08-17). The only
 * entry workstreams call: it owns the SEMANTICS — budget counting, token
 * ceilings with pre-emptive interrupt, automatic resume grants, the narrowed
 * malformed policy, envelope stamping (seq + ts), sub-session depth, and
 * persistence — over a `SessionDriver` that owns the mechanics.
 *
 * Driver-agnostic by construction: imports neither `ai` nor the Agent SDK
 * nor node builtins; persistence is injected (`SessionPersistence`).
 */

import type { SessionDef, SessionOutcome, SessionTool, ToolContext } from './session-def.js';
import type {
  DriverResult,
  SessionDriver,
  SessionHandle,
  SessionResume,
} from './session-driver.js';
import type {
  RawPayload,
  SessionEventBody,
  SessionFailure,
  SessionStatus,
  TurnUsage,
  UserInputQuestion,
} from './session-events.js';
import type { SessionPersistence } from './session-store.js';

/**
 * Thrown by the shell's tool wrapper when a tool call's arguments fail the
 * tool's input schema — one of §3.3's narrowed malformed cases. Drivers
 * catch it and run their re-ask mechanics (the invalid args quoted back);
 * it is never an observation the model quietly ingests as a tool result.
 */
export class SessionToolArgsError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly issues: string,
  ) {
    super(`invalid arguments for tool \`${toolName}\`: ${issues}`);
    this.name = 'SessionToolArgsError';
  }
}

export interface AgentLoopInput<TOutcome> {
  def: SessionDef<TOutcome>;
  /** The work item this session serves (a doc path, an area, a flow id). */
  workItem: string;
  initialMessages: readonly string[];
  driver: SessionDriver;
  persistence: SessionPersistence;
  /** Minted by the run orchestrator; one transcript per session id. */
  sessionId: string;
  /**
   * Continue a parked/failed prior session (§3.3: a fresh budget grant over
   * an opaque cursor). The shell reads the prior transcript from
   * persistence; this session gets a fresh transcript starting at
   * `session-start { resumeOf }`.
   */
  resume?: { of: string; cursor?: unknown };
  signal?: AbortSignal;
  /** Clock + id mint, injectable for tests. */
  now?: () => string;
  mintSessionId?: () => string;
}

export interface AgentLoopHandle<TOutcome> {
  /** Resolves for every session — failures are data, never rejections. */
  outcome: Promise<SessionOutcome<TOutcome>>;
  /** Deliver a user message; timing per the driver's declared capability. */
  steer(message: string): void;
  status(): SessionStatus;
}

export function runAgentLoop<TOutcome>(input: AgentLoopInput<TOutcome>): AgentLoopHandle<TOutcome> {
  return startSession(input, 0);
}

/** `depth` is the sub-session depth: 0 = top-level, 1 = child (§3.3's max). */
function startSession<TOutcome>(
  input: AgentLoopInput<TOutcome>,
  depth: number,
): AgentLoopHandle<TOutcome> {
  const { def, workItem, driver, persistence, sessionId } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const mintSessionId = input.mintSessionId ?? (() => globalThis.crypto.randomUUID());

  // -------------------------------------------------------------------------
  // transcript: stamp the envelope (monotonic seq + ts) and persist
  // -------------------------------------------------------------------------
  let seq = 0;
  const append = (body: SessionEventBody & { raw?: RawPayload }): void => {
    const { raw, ...rest } = body;
    persistence.appendEvent(sessionId, {
      ...(rest as SessionEventBody),
      seq: seq++,
      ts: now(),
      ...(raw ? { raw } : {}),
    });
  };

  // -------------------------------------------------------------------------
  // rollups the shell tracks from its own events
  // -------------------------------------------------------------------------
  let turns = 0;
  let tokens = 0;
  let costUsd = 0;
  const pendingQuestions = new Map<string, UserInputQuestion>();
  let status: SessionStatus = 'running';
  const spent = () => ({ turns, tokens, costUsd });

  const updateIndex = (extra?: { resumeCursor?: unknown; providerSessionId?: string }) => {
    persistence.updateIndex({
      sessionId,
      kind: def.kind,
      workItem,
      status,
      spent: spent(),
      ...extra,
    });
  };

  // -------------------------------------------------------------------------
  // the driver run
  // -------------------------------------------------------------------------
  let handle: SessionHandle | undefined;
  let pendingInterrupt = false;
  /** Why the SHELL stopped the session — rewrites the driver's generic
   *  ended-without-outcome failure into the semantic one. */
  let interruptCause: 'budget' | 'context' | 'malformed' | 'aborted' | undefined;

  const requestInterrupt = (): void => {
    if (handle) void handle.interrupt();
    else pendingInterrupt = true;
  };

  // Budget = assistant messages, counted by the SHELL from its own events
  // (§3.3: the driver's own turn numbers are never read). Enforcement is
  // interrupt() at the turn boundary; ceilings may overshoot by one turn,
  // which stays recorded.
  let turnsThisGrant = 0;
  let grantsUsed = 0;

  // The narrowed malformed policy (§3.3): text turns are LEGAL and never
  // re-asked; a re-ask marks its TURN malformed (several re-asked calls in
  // one turn are still one malformed turn), and two CONSECUTIVE malformed
  // turns end the session. Any turn without a re-ask breaks the streak.
  let prevTurnMalformed = false;
  let currentTurnMalformed = false;

  const track = (body: SessionEventBody & { raw?: RawPayload }): void => {
    append(body);
    switch (body.type) {
      case 'assistant-turn': {
        turns += 1;
        turnsThisGrant += 1;
        tokens += totalTokens(body.usage);
        costUsd += body.usage.costUsd;
        prevTurnMalformed = currentTurnMalformed;
        currentTurnMalformed = false;
        // Context is a LEVEL: this turn's envelope approximates occupancy.
        // Crossing the ceiling pre-empts the provider wall — compaction
        // never runs, and no resume grant softens it (§3.3).
        if (totalTokens(body.usage) >= def.budget.tokenCeiling) {
          interruptCause = 'context';
          requestInterrupt();
        } else if (turnsThisGrant >= def.budget.turns) {
          if (grantsUsed < def.budget.maxResumes) {
            // Automatic resume: a fresh grant, in-run, no interruption.
            grantsUsed += 1;
            turnsThisGrant = 0;
            append({ type: 'resume-grant', grant: grantsUsed, of: def.budget.maxResumes });
          } else {
            interruptCause = 'budget';
            requestInterrupt();
          }
        }
        break;
      }
      case 're-ask': {
        if (!currentTurnMalformed) {
          currentTurnMalformed = true;
          if (prevTurnMalformed) {
            interruptCause = 'malformed';
            requestInterrupt();
          }
        }
        break;
      }
      case 'question-asked':
        pendingQuestions.set(body.question.id, body.question);
        break;
      case 'question-resolved':
        pendingQuestions.delete(body.questionId);
        break;
      default:
        break;
    }
  };

  const outcome = (async (): Promise<SessionOutcome<TOutcome>> => {
    append({
      type: 'session-start',
      kind: def.kind,
      workItem,
      systemPrompt: def.systemPrompt,
      toolNames: def.tools.map((t) => t.name),
      ...(input.resume ? { resumeOf: input.resume.of } : {}),
      llm: driver.attribution,
    });
    updateIndex();

    // The shell's own signal is what drivers and tools see; an external
    // abort funnels through it and through interrupt(), so the in-flight
    // turn still settles and the transcript ends in a recorded failure.
    const controller = new AbortController();
    const onAbort = (): void => {
      interruptCause = 'aborted';
      controller.abort();
      requestInterrupt();
    };
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });

    // The shell validates args against each tool's input schema before its
    // `execute` runs, in either driver, and owns the ToolContext (drivers
    // pass a ctx of their own; it is ignored).
    const toolCtx: ToolContext = {
      workItem,
      signal: controller.signal,
      // Orchestrator → worker is the only topology (§3.3 depth 1). A child
      // dispatching its own child gets a structured failure the parent sees
      // as a tool result — never a grandchild session, never a throw.
      async dispatchChild<TChild>(childDef: SessionDef<TChild>, childMessages: readonly string[]) {
        if (depth >= 1) {
          return {
            status: 'failed' as const,
            failure: {
              kind: 'transport' as const,
              detail: 'sub-session depth exceeded: a child session may not dispatch children',
              class: 'validation' as const,
              retryability: 'none' as const,
            },
            resumable: false,
            spent: { turns: 0, tokens: 0, costUsd: 0 },
          };
        }
        const childId = mintSessionId();
        const linkage = { sessionId: childId, kind: childDef.kind, workItem };
        append({ type: 'child-session', phase: 'started', child: linkage });
        const child = startSession(
          {
            def: childDef,
            workItem,
            initialMessages: childMessages,
            driver,
            persistence,
            sessionId: childId,
            signal: controller.signal,
            now,
            mintSessionId,
          },
          depth + 1,
        );
        const childOutcome = await child.outcome;
        append({
          type: 'child-session',
          phase: 'completed',
          child: linkage,
          status: childOutcome.status,
          spent: childOutcome.spent,
        });
        return childOutcome;
      },
    };
    const wrapTool = (tool: SessionTool): SessionTool => ({
      ...tool,
      async execute(args) {
        const parsed = tool.inputSchema.safeParse(args);
        if (!parsed.success) throw new SessionToolArgsError(tool.name, parsed.error.message);
        return tool.execute(parsed.data, toolCtx);
      },
    });

    const wrappedDef = { ...def, tools: def.tools.map(wrapTool) };
    const runOnce = async (
      resume: SessionResume | undefined,
      initialMessages: readonly string[] = input.initialMessages,
    ): Promise<DriverResult> => {
      try {
        handle = driver.runSession({
          def: wrappedDef,
          initialMessages,
          ...(resume ? { resume } : {}),
          onEvent: track,
          signal: controller.signal,
        });
        if (pendingInterrupt) void handle.interrupt();
        return await handle.done;
      } catch (err) {
        // `done` rejecting is reserved for driver defects — converted to a
        // structured failure so a defect never strands the run, but named
        // for what it is.
        const failure: SessionFailure = {
          kind: 'transport',
          detail: `driver defect: ${err instanceof Error ? err.message : String(err)}`,
          class: 'unknown',
          retryability: 'none',
        };
        return { kind: 'failure', failure };
      }
    };

    // A cross-process resume hands the driver the PRIOR session's persisted
    // transcript (audit truth) plus its opaque cursor (§3.3).
    const priorEvents = input.resume ? persistence.readEvents(input.resume.of) : [];
    let result = await runOnce(
      input.resume ? { cursor: input.resume.cursor, events: priorEvents } : undefined,
    );

    // TRANSIENT failures get exactly one retry, resuming over the transcript
    // so far; the failure is recorded honestly first. BLOCKED failures park
    // — hammering a blocked dependency is forbidden (§3.3).
    if (
      result.kind === 'failure' &&
      result.failure.retryability === 'transient' &&
      interruptCause === undefined
    ) {
      append({ type: 'failure', failure: result.failure });
      // The retry's context is the prior session's transcript (on a resume)
      // PLUS whatever this session recorded before the drop; the cursor
      // falls back to the resume's when the failed run minted none.
      const events = [...priorEvents, ...persistence.readEvents(sessionId)];
      const cursor = result.resumeCursor ?? input.resume?.cursor;
      // Initial messages replay only if the driver never ingested them —
      // drivers record `user-message` at the moment of ingestion, so the
      // transcript is the honest probe.
      const ingestedInitials = persistence
        .readEvents(sessionId)
        .some((e) => e.type === 'user-message');
      result = await runOnce({ cursor, events }, ingestedInitials ? [] : undefined);
    }

    // -----------------------------------------------------------------------
    // finalize: the outcome requirement (§3.2) — a session cannot end
    // without a structured outcome its schema accepts
    // -----------------------------------------------------------------------
    if (result.kind === 'outcome') {
      const parsed = def.outcomeSchema.safeParse(result.value);
      if (parsed.success) {
        append({ type: 'outcome', value: parsed.data });
        status = 'completed';
        updateIndex({ resumeCursor: result.resumeCursor });
        return {
          status: 'completed',
          output: parsed.data,
          pendingQuestions: [...pendingQuestions.values()],
          spent: spent(),
        };
      }
      const failure: SessionFailure = {
        kind: 'malformed',
        detail: `outcome failed schema: ${parsed.error.message}`,
        retryability: 'none',
      };
      return fail(failure, result.resumeCursor);
    }
    // The shell interrupted; the driver's generic ended-without-outcome
    // failure is rewritten into the semantic one — unless the in-flight
    // turn still landed a valid outcome (handled above: completion wins).
    if (interruptCause === 'budget') {
      return fail(
        { kind: 'budget-exhausted', notReached: workItem, retryability: 'none' },
        result.resumeCursor,
      );
    }
    if (interruptCause === 'context') {
      return fail({ kind: 'context-exhausted', retryability: 'none' }, result.resumeCursor);
    }
    if (interruptCause === 'malformed') {
      return fail(
        { kind: 'malformed', detail: 'two consecutive malformed turns', retryability: 'none' },
        result.resumeCursor,
      );
    }
    if (interruptCause === 'aborted') {
      return fail(
        { kind: 'transport', detail: 'aborted by caller', class: 'unknown', retryability: 'none' },
        result.resumeCursor,
      );
    }
    return fail(result.failure, result.resumeCursor);

    function fail(failure: SessionFailure, resumeCursor?: unknown): SessionOutcome<TOutcome> {
      append({ type: 'failure', failure });
      status = failure.retryability === 'blocked' ? 'parked' : 'failed';
      updateIndex({ resumeCursor });
      return {
        status: 'failed',
        failure,
        resumable: failure.kind !== 'session-lost',
        spent: spent(),
      };
    }
  })();

  return {
    outcome,
    steer: (message) => handle?.steer(message),
    status: () => status,
  };
}

/** Total tokens a turn moved — cache reads included (they occupy context). */
function totalTokens(usage: TurnUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
}
